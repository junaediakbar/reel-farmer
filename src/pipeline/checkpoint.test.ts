import { describe, expect, test } from "bun:test";
import { CheckpointManager } from "./checkpoint";

describe("CheckpointManager", () => {
  test("creates and reads back a run", () => {
    const cp = new CheckpointManager(":memory:");
    const run = cp.createRun("run-1", "vid-1", "https://youtube.com/watch?v=vid-1", "Title");
    expect(run.status).toBe("pending");
    expect(cp.getRun("run-1")).toEqual(run);
    cp.close();
  });

  test("getResumableState reports only completed global stages", () => {
    const cp = new CheckpointManager(":memory:");
    cp.createRun("run-1", "vid-1", "https://x", null);

    cp.startStage("run-1", "DOWNLOAD");
    cp.completeStage("run-1", "DOWNLOAD");

    cp.startStage("run-1", "TRANSCRIBE");
    cp.failStage("run-1", "TRANSCRIBE", "boom");

    const state = cp.getResumableState("run-1");
    expect(state.completedGlobalStages.has("DOWNLOAD")).toBe(true);
    expect(state.completedGlobalStages.has("TRANSCRIBE")).toBe(false);
    expect(state.completedGlobalStages.has("IDENTIFY_CLIPS")).toBe(false);
    cp.close();
  });

  test("getResumableState tracks completed per-clip stages independently per clip", () => {
    const cp = new CheckpointManager(":memory:");
    cp.createRun("run-1", "vid-1", "https://x", null);

    cp.startClipStage("run-1", "clip-a", "EXTRACT_CLIPS");
    cp.completeClipStage("run-1", "clip-a", "EXTRACT_CLIPS", "/out/a.mp4");
    cp.startClipStage("run-1", "clip-b", "EXTRACT_CLIPS");
    cp.failClipStage("run-1", "clip-b", "EXTRACT_CLIPS", "ffmpeg exploded");

    const state = cp.getResumableState("run-1");
    expect(state.clips.get("clip-a")?.has("EXTRACT_CLIPS")).toBe(true);
    expect(state.clips.get("clip-b")?.has("EXTRACT_CLIPS") ?? false).toBe(false);
    cp.close();
  });

  test("deleteRun removes run, stage, and clip rows", () => {
    const cp = new CheckpointManager(":memory:");
    cp.createRun("run-1", "vid-1", "https://x", null);
    cp.startStage("run-1", "DOWNLOAD");
    cp.completeStage("run-1", "DOWNLOAD");
    cp.startClipStage("run-1", "clip-a", "EXTRACT_CLIPS");

    cp.deleteRun("run-1");

    expect(cp.getRun("run-1")).toBeNull();
    expect(cp.getStageResult("run-1", "DOWNLOAD")).toBeNull();
    expect(cp.getClipProgress("run-1")).toEqual([]);
    cp.close();
  });

  test("setRunVideoInfo patches the placeholder video_id/title", () => {
    const cp = new CheckpointManager(":memory:");
    cp.createRun("run-1", "", "https://x", null);
    cp.setRunVideoInfo("run-1", "vid-123", "Real Title");
    const run = cp.getRun("run-1");
    expect(run?.videoId).toBe("vid-123");
    expect(run?.title).toBe("Real Title");
    cp.close();
  });
});
