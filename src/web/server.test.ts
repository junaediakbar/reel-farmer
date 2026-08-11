import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ClipCandidate } from "../pipeline/types";

const processSelectedClipsCalls: Array<{ runId: string; selectedClips: ClipCandidate[] }> = [];

mock.module("../pipeline/orchestrator", () => ({
  runUntilSelection: mock(async () => {}),
  processSelectedClips: mock(async (_cp: unknown, runId: string, selectedClips: ClipCandidate[]) => {
    processSelectedClipsCalls.push({ runId, selectedClips });
  }),
  regenerateCaptionOverlay: mock(async () => {}),
  finalClipPath: (outputDir: string, clip: ClipCandidate) => join(outputDir, `${clip.title}-${clip.id}.mp4`),
}));

const { createServer } = await import("./server");
const { CheckpointManager } = await import("../pipeline/checkpoint");
const { config } = await import("../config");

let checkpoint: InstanceType<typeof CheckpointManager>;
let server: ReturnType<typeof createServer>;
let baseUrl: string;

beforeEach(() => {
  processSelectedClipsCalls.length = 0;
  checkpoint = new CheckpointManager(":memory:");
  server = createServer(checkpoint, 0);
  baseUrl = `http://localhost:${server.port}`;
});

afterEach(() => {
  server.stop(true);
});

describe("POST /api/runs + GET /api/runs", () => {
  test("creating a run makes it show up in the list", async () => {
    const res = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      body: JSON.stringify({ youtubeUrl: "https://youtube.com/watch?v=vid-1" }),
    });
    expect(res.status).toBe(201);
    const { runId } = (await res.json()) as { runId: string };
    expect(runId).toBeTruthy();

    const listRes = await fetch(`${baseUrl}/api/runs`);
    const runs = (await listRes.json()) as Array<{ id: string }>;
    expect(runs.map((r) => r.id)).toContain(runId);
  });
});

describe("DELETE /api/runs/:id", () => {
  test("removes the run from the list and deletes its data dir", async () => {
    const run = checkpoint.createRun("run-del", "vid-1", "https://x", null);
    const runDir = join(config.runsDir, run.id);
    mkdirSync(runDir, { recursive: true });
    await Bun.write(join(runDir, "marker.txt"), "x");

    const res = await fetch(`${baseUrl}/api/runs/${run.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    expect(checkpoint.getRun(run.id)).toBeNull();
    expect(existsSync(runDir)).toBe(false);
  });
});

describe("GET /api/runs/:id/video", () => {
  test("serves a byte range with 206 and a correct Content-Range", async () => {
    const run = checkpoint.createRun("run-vid", "vid-1", "https://x", null);
    const runDir = join(config.runsDir, run.id);
    mkdirSync(runDir, { recursive: true });
    const videoPath = join(runDir, "source.mp4");
    const content = "0123456789";
    await Bun.write(videoPath, content);
    await Bun.write(
      join(runDir, "download-result.json"),
      JSON.stringify({ videoId: "vid-1", title: "T", durationSec: 1, videoPath, subtitlePath: null }),
    );

    const res = await fetch(`${baseUrl}/api/runs/${run.id}/video`, { headers: { Range: "bytes=2-5" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 2-5/${content.length}`);
    expect(await res.text()).toBe("2345");

    rmSync(runDir, { recursive: true, force: true });
  });
});

describe("POST /api/runs/:id/select", () => {
  test("triggers processSelectedClips with the posted clip list", async () => {
    const run = checkpoint.createRun("run-select", "vid-1", "https://x", null);
    const selected: ClipCandidate[] = [
      { id: "c1", title: "Clip", hookLine: "hook", startSec: 0, endSec: 10, reason: "r", viralScore: 1, tags: [] },
    ];

    const res = await fetch(`${baseUrl}/api/runs/${run.id}/select`, { method: "POST", body: JSON.stringify(selected) });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget call land
    expect(processSelectedClipsCalls).toHaveLength(1);
    expect(processSelectedClipsCalls[0]!.runId).toBe(run.id);
    expect(processSelectedClipsCalls[0]!.selectedClips).toEqual(selected);
  });
});

describe("GET /api/deps/status", () => {
  test("reports the 4 managed dependencies with an installed flag and size estimate", async () => {
    const res = await fetch(`${baseUrl}/api/deps/status`);
    expect(res.status).toBe(200);
    const statuses = (await res.json()) as Array<{ id: string; installed: boolean; sizeEstimateMb: number }>;
    expect(statuses.map((s) => s.id).sort()).toEqual(["ffmpeg", "whisper-cli", "whisper-model", "yt-dlp"]);
    for (const s of statuses) {
      expect(typeof s.installed).toBe("boolean");
      expect(s.sizeEstimateMb).toBeGreaterThan(0);
    }
  });
});
