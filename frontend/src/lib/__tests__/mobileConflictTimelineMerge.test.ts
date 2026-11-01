import { describe, expect, it } from "vitest";
import { decideTimelineMerge, TIMELINE_SKEW_TOLERANCE_MS } from "../mobileConflictTimeline";

const base = {
  id: "note-a",
  contentFormat: "markdown",
};

describe("时间线自动合并的判定", () => {
  it("时间线合并让较新的一版胜出，并把可归档的一版交给调用方", () => {
    const local = { ...base, updatedAt: "2026-11-01T12:10:00.000Z" };
    const remote = { ...base, updatedAt: "2026-11-01T12:00:00.000Z" };
    expect(decideTimelineMerge(local, remote)).toMatchObject({ winner: "local" });
    expect(decideTimelineMerge(remote, local)).toMatchObject({ winner: "remote" });
  });

  it("时钟容差内的两次修改被视为同时编辑，不自动合并", () => {
    const local = { ...base, updatedAt: "2026-11-01T12:00:00.000Z" };
    const remote = { ...base, updatedAt: new Date(Date.parse(local.updatedAt) + TIMELINE_SKEW_TOLERANCE_MS).toISOString() };
    expect(decideTimelineMerge(local, remote)).toBeNull();
    expect(decideTimelineMerge(local, { ...remote, updatedAt: local.updatedAt })).toBeNull();
  });

  it("删除意图、树生命周期、缺失时间与不同实体都不自动合并", () => {
    const local = { ...base, updatedAt: "2026-11-01T12:10:00.000Z" };
    const remote = { ...base, updatedAt: "2026-11-01T12:00:00.000Z" };
    expect(decideTimelineMerge(local, { ...remote, __delete: true })).toBeNull();
    expect(decideTimelineMerge({ ...local, _deletionRecovery: { note: {} } }, remote)).toBeNull();
    expect(decideTimelineMerge({ ...local, lifecycle: "trash" }, remote)).toBeNull();
    expect(decideTimelineMerge({ id: "note-a" }, remote)).toBeNull();
    expect(decideTimelineMerge(local, { ...remote, id: "note-b" })).toBeNull();
    expect(decideTimelineMerge(null, remote)).toBeNull();
  });
});
