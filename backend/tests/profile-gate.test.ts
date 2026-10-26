import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

import path from "node:path";
import test from "node:test";

/**
 * W2 profile 门单测。
 * 进程环境 NOWEN_PROFILE 未设置 → 完整模式：全部启用、守卫直通。
 * lite 行为用子进程验证（SERVER_PROFILE 在模块加载时求值，同进程内不可切换）。
 */

test("完整模式下所有 feature 启用", async () => {
  const profile = await import("../src/profile");
  assert.equal(profile.SERVER_PROFILE, "full");
  assert.equal(profile.isLiteProfile(), false);
  for (const feature of [
    "ai",
    "tasks",
    "diary",
    "mindmap",
    "collab",
    "sharing",
    "plugins",
    "openApi",
    "importCenter",
    "sheet",
    "voiceMemo",
    "automation",
  ]) {
    assert.equal(profile.isFeatureEnabled(feature), true, feature);
  }
  // P0 键不在 P1 集合内，任何模式下都返回 true。
  assert.equal(profile.isFeatureEnabled("notes"), true);
});

test("featureGuard 在完整模式下直通", async () => {
  const { Hono } = await import("hono");
  const { featureGuard } = await import("../src/profile");
  const app = new Hono();
  app.use("/api/ai/*", featureGuard("ai"));
  app.get("/api/ai/ping", (c) => c.json({ ok: true }));
  const res = await app.request("/api/ai/ping");
  assert.equal(res.status, 200);
});

function runLiteSubprocess(script: string): void {
  // tsx 对 --eval 的命名导出处理有坑；.mts 临时文件必须落在 backend 目录内，
  // 否则 node 无法从 /tmp 解析 hono 等依赖。
  const backendDir = path.resolve(import.meta.dirname, "..");
  const file = path.join(backendDir, `.tmp-profile-check-${process.pid}.mts`);
  fs.writeFileSync(file, script);
  try {
    const out = execFileSync(process.execPath, ["--import", "tsx", file], {
      cwd: backendDir,
      encoding: "utf8",
      env: { ...process.env, NOWEN_PROFILE: "lite" },
      timeout: 60_000,
    });
    assert.match(out, /ok/);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

test("NOWEN_PROFILE=lite 子进程：P1 关闭、守卫 403、响应体为明确禁用错误", () => {
  runLiteSubprocess(`
    import assert from "node:assert/strict";
    import { Hono } from "hono";
    const { SERVER_PROFILE, isFeatureEnabled, featureGuard, featureDisabledBody } = await import("${path.resolve(import.meta.dirname, "../src/profile.ts").replace(/\\/g, "\\\\\\\\")}");
    assert.equal(SERVER_PROFILE, "lite");
    assert.equal(isFeatureEnabled("tasks"), false);
    assert.equal(isFeatureEnabled("notes"), true);
    const app = new Hono();
    app.use("/api/tasks/*", featureGuard("tasks"));
    app.get("/api/tasks/x", (c) => c.json({ ok: true }));
    const res = await app.request("/api/tasks/x");
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), featureDisabledBody("tasks"));
    console.log("ok");
  `);
});

test("lite 子进程：被禁模块禁用错误体包含 feature 键与错误码", () => {
  runLiteSubprocess(`
    import assert from "node:assert/strict";
    const { featureDisabledBody } = await import("${path.resolve(import.meta.dirname, "../src/profile.ts").replace(/\\/g, "\\\\\\\\")}");
    const body = featureDisabledBody("ai");
    assert.equal(body.error, "feature_disabled");
    assert.equal(body.feature, "ai");
    assert.ok(body.message.length > 0);
    console.log("ok");
  `);
});
