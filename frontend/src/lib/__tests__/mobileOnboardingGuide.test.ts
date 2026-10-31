import { beforeEach, describe, expect, it, vi } from "vitest";

import { isMobileGuideEntityId, seedMobileLocalGuide } from "../mobileOnboardingGuide";
import type { NativeLocalRepository } from "../nativeLocalRepository";

function createRepository() {
  const notebooks: Array<Record<string, unknown>> = [];
  const notes: Array<Record<string, unknown>> = [];
  const repository = {
    notebooks: {
      list: vi.fn(async () => notebooks),
      create: vi.fn(async (input: Record<string, unknown>) => {
        notebooks.push(input);
        return { id: input.id, savedAt: "now" };
      }),
    },
    notes: {
      create: vi.fn(async (input: Record<string, unknown>) => {
        notes.push(input);
        return { id: input.id, savedAt: "now" };
      }),
    },
  };
  return { repository: repository as unknown as NativeLocalRepository, notebooks, notes };
}

describe("mobile device-local guide", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("seeds one 中文指南 notebook with eight markdown notes using onboarding ids", async () => {
    const { repository, notebooks, notes } = createRepository();
    await seedMobileLocalGuide(repository);

    expect(notebooks).toHaveLength(4);
    expect(notebooks[0]).toMatchObject({
      id: "onboarding-v1-local-zh",
      name: "中文指南",
      icon: "🇨🇳",
    });
    expect(notebooks.slice(1).map((notebook) => notebook.name)).toEqual([
      "工作笔记",
      "个人日记",
      "技术学习",
    ]);
    expect(notes).toHaveLength(1);
    expect(notes.every((note) => String(note.id).startsWith("onboarding-v1-local-zh-"))).toBe(true);
    expect(notes.every((note) => note.notebookId === "onboarding-v1-local-zh")).toBe(true);
    expect(notes.every((note) => note.contentFormat === "markdown")).toBe(true);
    expect(notes.find((note) => note.id === "onboarding-v1-local-zh-welcome")).toMatchObject({
      title: "欢迎使用 Nowen Note",
      isPinned: 1,
    });
  });

  it("seeds only once", async () => {
    const first = createRepository();
    await seedMobileLocalGuide(first.repository);
    const second = createRepository();
    await seedMobileLocalGuide(second.repository);
    expect(second.notebooks).toHaveLength(0);
    expect(second.notes).toHaveLength(0);
  });

  it("does not seed another guide when one already exists (e.g. synced from another device)", async () => {
    const { repository, notebooks, notes } = createRepository();
    notebooks.push({ id: "onboarding-v1-serverowner-zh", name: "中文指南" });
    await seedMobileLocalGuide(repository);
    expect(notebooks).toHaveLength(1);
    expect(notes).toHaveLength(0);
  });

  it("recognises guide entities by id, including tree node prefixes", () => {
    expect(isMobileGuideEntityId("onboarding-v1-local-zh")).toBe(true);
    expect(isMobileGuideEntityId("onboarding-v1-local-zh-welcome")).toBe(true);
    expect(isMobileGuideEntityId("notebook:onboarding-v1-local-zh")).toBe(true);
    expect(isMobileGuideEntityId("note:onboarding-v1-local-zh-welcome")).toBe(true);
    expect(isMobileGuideEntityId("onboarding-v1-remote-user-zh")).toBe(true);
    expect(isMobileGuideEntityId("note:regular-note")).toBe(false);
    expect(isMobileGuideEntityId("notebook:regular")).toBe(false);
  });
});
