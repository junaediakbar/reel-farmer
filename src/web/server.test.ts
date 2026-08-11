import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
  delete process.env.LICENSE_SERVER_URL;
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

describe("POST /api/runs/:id/retry", () => {
  test("returns 400 for a run that isn't failed", async () => {
    const run = checkpoint.createRun("run-notfailed", "vid-1", "https://x", null);
    const res = await fetch(`${baseUrl}/api/runs/${run.id}/retry`, { method: "POST" });
    expect(res.status).toBe(400);
  });

  test("failed during a global stage resumes via runUntilSelection", async () => {
    const run = checkpoint.createRun("run-retry-global", "vid-1", "https://x", null);
    checkpoint.updateRunStatus(run.id, "failed", "TRANSCRIBE", "boom");

    const res = await fetch(`${baseUrl}/api/runs/${run.id}/retry`, { method: "POST" });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    const { runUntilSelection } = await import("../pipeline/orchestrator");
    expect((runUntilSelection as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(0);
  });

  test("failed during clip rendering resumes via processSelectedClips using the persisted clips.json", async () => {
    const run = checkpoint.createRun("run-retry-clip", "vid-1", "https://x", null);
    checkpoint.updateRunStatus(run.id, "failed", "EXTRACT_CLIPS", "boom");
    const runDir = join(config.runsDir, run.id);
    mkdirSync(runDir, { recursive: true });
    const selected: ClipCandidate[] = [
      { id: "c1", title: "Clip", hookLine: "hook", startSec: 0, endSec: 10, reason: "r", viralScore: 1, tags: [] },
    ];
    await Bun.write(join(runDir, "clips.json"), JSON.stringify(selected));

    const res = await fetch(`${baseUrl}/api/runs/${run.id}/retry`, { method: "POST" });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(processSelectedClipsCalls.some((c) => c.runId === run.id)).toBe(true);

    rmSync(runDir, { recursive: true, force: true });
  });
});

describe("GET /api/clips", () => {
  test("returns only clips whose 4 render stages all completed", async () => {
    const run = checkpoint.createRun("run-lib", "vid-1", "https://x", "My Run");
    const runDir = join(config.runsDir, run.id);
    mkdirSync(runDir, { recursive: true });
    const clips: ClipCandidate[] = [
      { id: "rendered", title: "Rendered clip", hookLine: "h", startSec: 0, endSec: 20, reason: "r", viralScore: 77, tags: ["a"] },
      { id: "partial", title: "Partial clip", hookLine: "h", startSec: 0, endSec: 10, reason: "r", viralScore: 10, tags: [] },
    ];
    await Bun.write(join(runDir, "clips.json"), JSON.stringify(clips));

    for (const stage of ["EXTRACT_CLIPS", "REMOVE_SILENCE", "GENERATE_CAPTIONS", "COMPOSE_REEL"] as const) {
      checkpoint.startClipStage(run.id, "rendered", stage);
      checkpoint.completeClipStage(run.id, "rendered", stage, "/out/rendered.mp4");
    }
    checkpoint.startClipStage(run.id, "partial", "EXTRACT_CLIPS");
    checkpoint.completeClipStage(run.id, "partial", "EXTRACT_CLIPS", "/tmp/raw.mp4");

    const res = await fetch(`${baseUrl}/api/clips`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ clipId: string; title: string; viralScore: number; durationSec: number }>;
    expect(body.map((c) => c.clipId)).toEqual(["rendered"]);
    expect(body[0]).toMatchObject({ title: "Rendered clip", viralScore: 77, durationSec: 20 });

    rmSync(runDir, { recursive: true, force: true });
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

describe("GET /api/license/status", () => {
  test("is a no-op pass when LICENSE_SERVER_URL is unset", async () => {
    const res = await fetch(`${baseUrl}/api/license/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true, mode: "disabled" });
  });
});

describe("POST /api/license/activate", () => {
  test("returns 400 when licenseKey is missing", async () => {
    const res = await fetch(`${baseUrl}/api/license/activate`, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  test("returns 400 when LICENSE_SERVER_URL is unset (activation requires a configured server)", async () => {
    const res = await fetch(`${baseUrl}/api/license/activate`, {
      method: "POST",
      body: JSON.stringify({ licenseKey: "some-key" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET/POST /api/settings/deepseek-key", () => {
  let testDir: string;
  let originalSettingsPath: string;
  let originalDeepSeekEnv: string | undefined;

  beforeEach(() => {
    originalSettingsPath = config.settingsPath;
    originalDeepSeekEnv = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    testDir = mkdtempSync(join(tmpdir(), "reel-farmer-settings-test-"));
    config.settingsPath = join(testDir, "settings.json");
  });

  afterEach(() => {
    config.settingsPath = originalSettingsPath;
    if (originalDeepSeekEnv === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalDeepSeekEnv;
    rmSync(testDir, { recursive: true, force: true });
  });

  test("reports unset, then set with a masked preview after saving a key", async () => {
    const before = await fetch(`${baseUrl}/api/settings/deepseek-key`);
    expect(await before.json()).toEqual({ set: false, preview: null });

    const save = await fetch(`${baseUrl}/api/settings/deepseek-key`, {
      method: "POST",
      body: JSON.stringify({ deepseekApiKey: "sk-abcd1234" }),
    });
    expect(save.status).toBe(200);

    const after = await fetch(`${baseUrl}/api/settings/deepseek-key`);
    expect(await after.json()).toEqual({ set: true, preview: "••••1234" });
  });

  test("returns 400 when deepseekApiKey is missing", async () => {
    const res = await fetch(`${baseUrl}/api/settings/deepseek-key`, { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });
});
