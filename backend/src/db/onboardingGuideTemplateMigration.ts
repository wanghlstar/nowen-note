import type Database from "better-sqlite3";
import type { Migration } from "./migrations.impl.js";
import {
  ONBOARDING_ID_PREFIX,
  ONBOARDING_VERSION,
  buildOnboardingGuideSeedSql,
} from "./onboardingGuideTemplate.js";

/**
 * v136 replaces the first-login onboarding trigger installed by v68 so new
 * accounts receive the trimmed guide template (one 中文指南 notebook, Markdown
 * only) instead of the old root + bilingual tree.
 *
 * Existing accounts are untouched: their user_onboarding_state row marks the
 * guide as handled, exactly like v68.
 */
export const onboardingGuideTemplateMigration: Migration = {
  version: 136,
  name: "onboarding-guide-trimmed-template",
  up: (db: Database.Database) => {
    db.exec(`
      DROP TRIGGER IF EXISTS users_seed_onboarding_on_first_login;

      CREATE TRIGGER users_seed_onboarding_on_first_login
      AFTER UPDATE OF lastLoginAt ON users
      WHEN NEW.lastLoginAt IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM user_onboarding_state
          WHERE userId = NEW.id AND version = ${ONBOARDING_VERSION}
        )
        -- 账号已经有指南（例如从桌面端同步上来的种子）时不再重复创建。
        AND NOT EXISTS (
          SELECT 1
          FROM notebooks
          WHERE userId = NEW.id AND id LIKE '${ONBOARDING_ID_PREFIX}%'
        )
      BEGIN
        ${buildOnboardingGuideSeedSql()}

        INSERT INTO user_onboarding_state (
          userId, version, status, completedAt
        ) VALUES (
          NEW.id, ${ONBOARDING_VERSION}, 'seeded', datetime('now')
        );
      END;
    `);
  },
};
