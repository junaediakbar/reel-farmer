import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClipCandidate, CaptionStyle, PreProductionOptions } from "../pipeline/types";

const processSelectedClipsCalls: Array<{
  runId: string;
  selectedClips: ClipCandidate[];
  style?: CaptionStyle;
  preProduction?: PreProductionOptions;
}> = [];

let generateMoreClipsResult: ClipCandidate[] | Error = [];
const generateMoreClipsCalls: string[] = [];

mock.module("../pipeline/orchestrator", () => ({
  runUntilSelection: mock(async () => {}),
  processSelectedClips: mock(
    async (
      _cp: unknown,
      runId: string,
      selectedClips: ClipCandidate[],
      style?: CaptionStyle,
      preProduction?: PreProductionOptions,
    ) => {
      processSelectedClipsCalls.push({ runId, selectedClips, style, preProduction });
    },
  ),
  regenerateCaptionOverlay: mock(async () => {}),
  retranscribeCaptionOverlay: mock(async () => {}),
  generateMoreClips: mock(async (_cp: unknown, runId: string) => {
    generateMoreClipsCalls.push(runId);
    if (generateMoreClipsResult instanceof Error) throw generateMoreClipsResult;
    return generateMoreClipsResult;
  }),
  finalClipPath: (outputDir: string, clip: ClipCandidate) => join(outputDir, `${clip.title}-${clip.id}.mp4`),
  finalThumbnailPath: (outputDir: string, clip: ClipCandidate) => join(outputDir, `${clip.title}-${clip.id}.jpg`),
}));



const { createServer } = await import("./server");
const { CheckpointManager } = await import("../pipeline/checkpoint");
const { config } = await import("../config");

let checkpoint: InstanceType<typeof CheckpointManager>;
let server: ReturnType<typeof createServer>;
let baseUrl: string;

beforeEach(() => {
  processSelectedClipsCalls.length = 0;
  generateMoreClipsCalls.length = 0;
  generateMoreClipsResult = [];
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

  test("removes only this run's own rendered clips, not a sibling run's sharing the same videoId", async () => {
    // existingVideoId lets two runs share one downloaded video, hence one outputDir per videoId.
    const clip: ClipCandidate = { id: "c1", title: "Clip", hookLine: "h", startSec: 0, endSec: 10, reason: "r", viralScore: 1, tags: [] };
    const outputDir = join(config.outputDir, "vid-shared");
    mkdirSync(outputDir, { recursive: true });
    const outPath = join(outputDir, `${clip.title}-${clip.id}.mp4`);
    await Bun.write(outPath, "rendered");

    const runA = checkpoint.createRun("run-a", "vid-shared", "https://x", null);
    const runADir = join(config.runsDir, runA.id);
    mkdirSync(runADir, { recursive: true });
    await Bun.write(join(runADir, "clips.json"), JSON.stringify([clip]));

    const runB = checkpoint.createRun("run-b", "vid-shared", "https://x", null);
    const runBDir = join(config.runsDir, runB.id);
    mkdirSync(runBDir, { recursive: true });
    // run B never rendered this clip — its clips.json is unrelated/empty.
    await Bun.write(join(runBDir, "clips.json"), JSON.stringify([]));

    const res = await fetch(`${baseUrl}/api/runs/${runB.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    expect(checkpoint.getRun(runA.id)).not.toBeNull();
    expect(existsSync(outPath)).toBe(true);

    rmSync(runADir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  });
});

describe("DELETE /api/runs/:id/clips/:clipId", () => {
  test("without ?purge, deletes the render but keeps the candidate in clips.json", async () => {
    const run = checkpoint.createRun("run-c", "vid-2", "https://x", null);
    const runDir = join(config.runsDir, run.id);
    mkdirSync(runDir, { recursive: true });
    const clip: ClipCandidate = { id: "clip-a", title: "Clip A", hookLine: "h", startSec: 0, endSec: 10, reason: "r", viralScore: 1, tags: [] };
    await Bun.write(join(runDir, "clips.json"), JSON.stringify([clip]));

    const res = await fetch(`${baseUrl}/api/runs/${run.id}/clips/${clip.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const clipsJson = (await Bun.file(join(runDir, "clips.json")).json()) as ClipCandidate[];
    expect(clipsJson.map((c) => c.id)).toEqual(["clip-a"]);

    rmSync(runDir, { recursive: true, force: true });
  });

  test("with ?purge, also removes the candidate from clips.json so it can't reappear", async () => {
    const run = checkpoint.createRun("run-d", "vid-3", "https://x", null);
    const runDir = join(config.runsDir, run.id);
    mkdirSync(runDir, { recursive: true });
    const keep: ClipCandidate = { id: "clip-keep", title: "Keep", hookLine: "h", startSec: 0, endSec: 10, reason: "r", viralScore: 1, tags: [] };
    const drop: ClipCandidate = { id: "clip-drop", title: "Drop", hookLine: "h", startSec: 10, endSec: 20, reason: "r", viralScore: 1, tags: [] };
    await Bun.write(join(runDir, "clips.json"), JSON.stringify([keep, drop]));

    const res = await fetch(`${baseUrl}/api/runs/${run.id}/clips/${drop.id}?purge=1`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const clipsJson = (await Bun.file(join(runDir, "clips.json")).json()) as ClipCandidate[];
    expect(clipsJson.map((c) => c.id)).toEqual(["clip-keep"]);

    rmSync(runDir, { recursive: true, force: true });
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

describe("POST /api/runs/:id/generate-more", () => {
  test("404 for an unknown run", async () => {
    const res = await fetch(`${baseUrl}/api/runs/nope/generate-more`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("400 for a run that hasn't finished IDENTIFY_CLIPS yet", async () => {
    const run = checkpoint.createRun("run-pending", "vid-1", "https://x", null); // default status: pending
    const res = await fetch(`${baseUrl}/api/runs/${run.id}/generate-more`, { method: "POST" });
    expect(res.status).toBe(400);
    expect(generateMoreClipsCalls).toHaveLength(0);
  });

  test("returns the new clips for a run awaiting selection", async () => {
    const run = checkpoint.createRun("run-await", "vid-1", "https://x", null);
    checkpoint.updateRunStatus(run.id, "awaiting_selection", null);
    const newClips: ClipCandidate[] = [
      { id: "more-1", title: "More clip", hookLine: "hook", startSec: 0, endSec: 10, reason: "r", viralScore: 50, tags: [] },
    ];
    generateMoreClipsResult = newClips;

    const res = await fetch(`${baseUrl}/api/runs/${run.id}/generate-more`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ clips: newClips });
    expect(generateMoreClipsCalls).toEqual([run.id]);
  });

  test("500 with the error message if generateMoreClips throws", async () => {
    const run = checkpoint.createRun("run-completed", "vid-1", "https://x", null);
    checkpoint.updateRunStatus(run.id, "completed", null);
    generateMoreClipsResult = new Error("DeepSeek quota exceeded");

    const res = await fetch(`${baseUrl}/api/runs/${run.id}/generate-more`, { method: "POST" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "DeepSeek quota exceeded" });
  });
});

describe("POST /api/runs/:id/select", () => {
  test("triggers processSelectedClips with the posted clip list and caption style", async () => {
    const run = checkpoint.createRun("run-select", "vid-1", "https://x", null);
    const selected: ClipCandidate[] = [
      { id: "c1", title: "Clip", hookLine: "hook", startSec: 0, endSec: 10, reason: "r", viralScore: 1, tags: [] },
    ];
    const style = { fontFamily: "Arial", fontSize: 44, fontWeight: 500, lineHeight: 1.3, outline: false, primaryColor: "#ffffff", activeColor: "#ffffff", position: "bottom" as const, animate: false };

    const res = await fetch(`${baseUrl}/api/runs/${run.id}/select`, {
      method: "POST",
      body: JSON.stringify({ clips: selected, style }),
    });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget call land
    expect(processSelectedClipsCalls).toHaveLength(1);
    expect(processSelectedClipsCalls[0]!.runId).toBe(run.id);
    expect(processSelectedClipsCalls[0]!.selectedClips).toEqual(selected);
    expect(processSelectedClipsCalls[0]!.style).toEqual(style);
  });

  test("rejects an empty clip list", async () => {
    const run = checkpoint.createRun("run-select-empty", "vid-1", "https://x", null);
    const res = await fetch(`${baseUrl}/api/runs/${run.id}/select`, {
      method: "POST",
      body: JSON.stringify({ clips: [] }),
    });
    expect(res.status).toBe(400);
    expect(processSelectedClipsCalls).toHaveLength(0);
  });

  test("passes preProduction through to processSelectedClips", async () => {
    const run = checkpoint.createRun("run-select-preprod", "vid-1", "https://x", null);
    const selected: ClipCandidate[] = [
      { id: "c1", title: "Clip", hookLine: "hook", startSec: 0, endSec: 10, reason: "r", viralScore: 1, tags: [] },
    ];
    const preProduction = { watermark: { imageAsset: "logo.png", position: "bottom-right" as const, opacity: 0.8 } };

    await fetch(`${baseUrl}/api/runs/${run.id}/select`, {
      method: "POST",
      body: JSON.stringify({ clips: selected, preProduction }),
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(processSelectedClipsCalls).toHaveLength(1);
    expect(processSelectedClipsCalls[0]!.preProduction).toEqual(preProduction);
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

describe("GET/POST /api/settings/ai-provider", () => {
  let testDir: string;
  let originalSettingsPath: string;

  beforeEach(() => {
    originalSettingsPath = config.settingsPath;
    testDir = mkdtempSync(join(tmpdir(), "reel-farmer-settings-test-"));
    config.settingsPath = join(testDir, "settings.json");
  });

  afterEach(() => {
    config.settingsPath = originalSettingsPath;
    rmSync(testDir, { recursive: true, force: true });
  });

  test("defaults to deepseek, then switches to nvidia after saving", async () => {
    const before = await fetch(`${baseUrl}/api/settings/ai-provider`);
    expect(await before.json()).toEqual({ provider: "deepseek" });

    const save = await fetch(`${baseUrl}/api/settings/ai-provider`, {
      method: "POST",
      body: JSON.stringify({ provider: "nvidia" }),
    });
    expect(save.status).toBe(200);

    const after = await fetch(`${baseUrl}/api/settings/ai-provider`);
    expect(await after.json()).toEqual({ provider: "nvidia" });
  });

  test("returns 400 for an unknown provider", async () => {
    const res = await fetch(`${baseUrl}/api/settings/ai-provider`, {
      method: "POST",
      body: JSON.stringify({ provider: "openai" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET/POST /api/settings/:provider-model", () => {
  let testDir: string;
  let originalSettingsPath: string;
  let originalDeepSeekModel: string | undefined;
  let originalNvidiaModel: string | undefined;

  beforeEach(() => {
    originalSettingsPath = config.settingsPath;
    originalDeepSeekModel = process.env.DEEPSEEK_MODEL;
    originalNvidiaModel = process.env.NVIDIA_MODEL;
    delete process.env.DEEPSEEK_MODEL;
    delete process.env.NVIDIA_MODEL;
    testDir = mkdtempSync(join(tmpdir(), "reel-farmer-settings-test-"));
    config.settingsPath = join(testDir, "settings.json");
  });

  afterEach(() => {
    config.settingsPath = originalSettingsPath;
    if (originalDeepSeekModel === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = originalDeepSeekModel;
    if (originalNvidiaModel === undefined) delete process.env.NVIDIA_MODEL;
    else process.env.NVIDIA_MODEL = originalNvidiaModel;
    rmSync(testDir, { recursive: true, force: true });
  });

  test("reports unset, then a saved model after POST", async () => {
    const before = await fetch(`${baseUrl}/api/settings/deepseek-model`);
    expect(await before.json()).toEqual({ set: false, model: null, history: [] });

    const save = await fetch(`${baseUrl}/api/settings/deepseek-model`, {
      method: "POST",
      body: JSON.stringify({ model: "deepseek-chat" }),
    });
    expect(save.status).toBe(200);

    const after = await fetch(`${baseUrl}/api/settings/deepseek-model`);
    expect(await after.json()).toEqual({ set: true, model: "deepseek-chat", history: ["deepseek-chat"] });
  });

  test("records a recently-used history, most recent first and deduped", async () => {
    await fetch(`${baseUrl}/api/settings/nvidia-model`, { method: "POST", body: JSON.stringify({ model: "meta/llama-3.1-405b-instruct" }) });
    await fetch(`${baseUrl}/api/settings/nvidia-model`, { method: "POST", body: JSON.stringify({ model: "deepseek-ai/deepseek-r1" }) });
    await fetch(`${baseUrl}/api/settings/nvidia-model`, { method: "POST", body: JSON.stringify({ model: "meta/llama-3.1-405b-instruct" }) });

    const res = await fetch(`${baseUrl}/api/settings/nvidia-model`);
    expect(await res.json()).toEqual({
      set: true,
      model: "meta/llama-3.1-405b-instruct",
      history: ["meta/llama-3.1-405b-instruct", "deepseek-ai/deepseek-r1"],
    });
  });

  test("returns 400 when model is missing or blank", async () => {
    for (const body of [{}, { model: "" }, { model: "   " }]) {
      const res = await fetch(`${baseUrl}/api/settings/nvidia-model`, { method: "POST", body: JSON.stringify(body) });
      expect(res.status).toBe(400);
    }
  });

  test("stores per-provider models independently", async () => {
    await fetch(`${baseUrl}/api/settings/deepseek-model`, { method: "POST", body: JSON.stringify({ model: "deepseek-chat" }) });

    const nvidia = await fetch(`${baseUrl}/api/settings/nvidia-model`);
    expect(await nvidia.json()).toEqual({ set: false, model: null, history: [] });
  });
});

describe("GET /api/settings/:provider-models", () => {
  let testDir: string;
  let originalSettingsPath: string;
  let originalDeepSeekKey: string | undefined;

  beforeEach(() => {
    originalSettingsPath = config.settingsPath;
    originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    testDir = mkdtempSync(join(tmpdir(), "reel-farmer-settings-test-"));
    config.settingsPath = join(testDir, "settings.json");
  });

  afterEach(() => {
    config.settingsPath = originalSettingsPath;
    if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
    rmSync(testDir, { recursive: true, force: true });
  });

  test("returns an empty list with a BYOK error instead of hitting the network when no key is set", async () => {
    const res = await fetch(`${baseUrl}/api/settings/deepseek-models`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: string[]; error: string };
    expect(body.models).toEqual([]);
    expect(body.error).toMatch(/DEEPSEEK_API_KEY/);
  });
});

describe("POST/GET /api/runs/:id/assets", () => {
  test("uploads an image and serves it back", async () => {
    const run = checkpoint.createRun("run-assets", "vid-1", "https://x", null);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "logo.png");

    const uploadRes = await fetch(`${baseUrl}/api/runs/${run.id}/assets`, { method: "POST", body: form });
    expect(uploadRes.status).toBe(201);
    const { asset } = (await uploadRes.json()) as { asset: string };
    expect(asset).toMatch(/\.png$/);

    const serveRes = await fetch(`${baseUrl}/api/runs/${run.id}/assets/${asset}`);
    expect(serveRes.status).toBe(200);
    expect(new Uint8Array(await serveRes.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("rejects a non-image upload", async () => {
    const run = checkpoint.createRun("run-assets-badtype", "vid-1", "https://x", null);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1])], { type: "text/plain" }), "evil.txt");

    const res = await fetch(`${baseUrl}/api/runs/${run.id}/assets`, { method: "POST", body: form });
    expect(res.status).toBe(400);
  });

  test("refuses to serve a path-traversal filename", async () => {
    const run = checkpoint.createRun("run-assets-traversal", "vid-1", "https://x", null);
    // A real file that a broken basename()/containment check would actually be able to reach,
    // sitting one level above assets/ — proves the guard, not just a missing directory.
    const runDir = join(config.runsDir, run.id);
    mkdirSync(join(runDir, "assets"), { recursive: true });
    writeFileSync(join(runDir, "sentinel.txt"), "should never be served");

    const res = await fetch(`${baseUrl}/api/runs/${run.id}/assets/${encodeURIComponent("../sentinel.txt")}`);
    expect(res.status).toBe(404);
  });
});
