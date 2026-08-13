import { beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CAPTION_STYLE, type CaptionGroup, type CaptionStyle, type ClipCandidate, type Transcript } from "./types";
// Statically imported (before any mock.module call below) so these bindings are the real
// implementations — used to spread the non-mocked exports back in, since mock.module replaces
// the whole module for every importer in this test process, including the modules' own *.test.ts.
import * as RealClipIdentifier from "../modules/clip-identifier";
import * as RealSilenceRemover from "../modules/silence-remover";
import * as RealCaptionGenerator from "../modules/caption-generator";
import * as RealComposer from "../modules/composer";

const callLog: string[] = [];
let activeExtracts = 0;
let peakConcurrentExtracts = 0;

function fixtureClips(n: number): ClipCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `clip-${i}`,
    title: `Clip ${i}`,
    hookLine: "hook",
    startSec: i * 30,
    endSec: i * 30 + 20,
    reason: "reason",
    viralScore: 100 - i,
    tags: [],
  }));
}

let clipsToReturn: ClipCandidate[] = fixtureClips(1);

mock.module("../modules/downloader", () => ({
  downloadVideo: mock(async () => {
    callLog.push("download");
    return {
      videoId: "vid-1",
      title: "Video One",
      durationSec: 300,
      videoPath: "/tmp/source.mp4",
      subtitlePath: null,
    };
  }),
}));

mock.module("../modules/transcriber", () => ({
  getTranscript: mock(async (): Promise<Transcript> => {
    callLog.push("transcribe");
    return { source: "youtube", segments: [{ text: "hello world", start: 0, end: 5 }] };
  }),
}));

mock.module("../modules/clip-identifier", () => ({
  ...RealClipIdentifier,
  identifyClips: mock(async () => {
    callLog.push("identify");
    return { clips: clipsToReturn, tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
  }),
}));

mock.module("../modules/extractor", () => ({
  extractClip: mock(async (_video: string, _s: number, _e: number, _out: string) => {
    activeExtracts++;
    peakConcurrentExtracts = Math.max(peakConcurrentExtracts, activeExtracts);
    await new Promise((r) => setTimeout(r, 20));
    activeExtracts--;
    callLog.push("extract");
  }),
}));

mock.module("../modules/silence-remover", () => ({
  ...RealSilenceRemover,
  detectSilence: mock(async () => []),
  removeSilence: mock(async () => {
    callLog.push("desilence");
  }),
}));

mock.module("../modules/caption-generator", () => ({
  ...RealCaptionGenerator,
  generateCaptions: mock(async (_audio: string, clipDir: string, _ref: string, _out: string, style: CaptionStyle) => {
    callLog.push("caption");
    const groups: CaptionGroup[] = [{ words: [{ word: "hi", start: 0, end: 0.5 }], start: 0, end: 0.5 }];
    await Bun.write(join(clipDir, "captions.json"), JSON.stringify({ groups, style }));
  }),
  renderCaptionOverlay: mock(async () => {
    callLog.push("regen-caption");
  }),
}));

mock.module("../modules/composer", () => ({
  ...RealComposer,
  composeReel: mock(async () => {
    callLog.push("compose");
  }),
  // Default (no thumbnail choice) auto-generates via ffmpeg's `thumbnail` filter — stub it so
  // these tests don't shell out; composeReel is mocked so finalPath never has real frames anyway.
  extractBestFrameThumbnail: mock(async () => {}),
}));

const { runPipeline, runUntilSelection, processSelectedClips, regenerateCaptionOverlay } = await import("./orchestrator");
const { CheckpointManager } = await import("./checkpoint");
const { config } = await import("../config");

beforeEach(() => {
  callLog.length = 0;
  activeExtracts = 0;
  peakConcurrentExtracts = 0;
  clipsToReturn = fixtureClips(1);
});

describe("runPipeline", () => {
  test("runs global stages in order, then per-clip stages, and marks the run completed", async () => {
    const cp = new CheckpointManager(":memory:");
    await runPipeline(cp, "https://youtube.com/watch?v=vid-1");

    expect(callLog.slice(0, 3)).toEqual(["download", "transcribe", "identify"]);
    expect(callLog.slice(3)).toEqual(["extract", "desilence", "caption", "compose"]);

    const runs = cp.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("completed");
    cp.close();
  });

  test("resume skips completed global stages and completed per-clip stages", async () => {
    const cp = new CheckpointManager(":memory:");
    const run = cp.createRun("run-resume", "", "https://youtube.com/watch?v=vid-1", null);

    const runDir = join(config.runsDir, run.id);
    mkdirSync(runDir, { recursive: true });
    await Bun.write(
      join(runDir, "download-result.json"),
      JSON.stringify({
        videoId: "vid-1",
        title: "Video One",
        durationSec: 300,
        videoPath: "/tmp/source.mp4",
        subtitlePath: null,
      }),
    );
    await Bun.write(
      join(runDir, "transcript.json"),
      JSON.stringify({ source: "youtube", segments: [{ text: "hello world", start: 0, end: 5 }] }),
    );

    cp.startStage(run.id, "DOWNLOAD");
    cp.completeStage(run.id, "DOWNLOAD");
    cp.startStage(run.id, "TRANSCRIBE");
    cp.completeStage(run.id, "TRANSCRIBE");
    // IDENTIFY_CLIPS intentionally left incomplete so it (and everything after) still runs.

    await runPipeline(cp, "https://youtube.com/watch?v=vid-1", run.id);

    expect(callLog).not.toContain("download");
    expect(callLog).not.toContain("transcribe");
    expect(callLog).toContain("identify");
    expect(callLog).toContain("extract");
    cp.close();
  });

  test("caps per-clip concurrency at MAX_PARALLEL_CLIPS", async () => {
    const originalMax = config.maxParallelClips;
    config.maxParallelClips = 2;
    clipsToReturn = fixtureClips(5);

    const cp = new CheckpointManager(":memory:");
    await runPipeline(cp, "https://youtube.com/watch?v=vid-1");

    expect(peakConcurrentExtracts).toBeLessThanOrEqual(2);
    expect(peakConcurrentExtracts).toBeGreaterThan(1);
    cp.close();
    config.maxParallelClips = originalMax;
  });
});

describe("runUntilSelection", () => {
  test("stops after IDENTIFY_CLIPS with awaiting_selection, writes clips.json, runs no clip stages", async () => {
    const cp = new CheckpointManager(":memory:");
    await runUntilSelection(cp, "https://youtube.com/watch?v=vid-1");

    expect(callLog).toEqual(["download", "transcribe", "identify"]);

    const runs = cp.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("awaiting_selection");

    const clipsJson = await Bun.file(join(config.runsDir, runs[0]!.id, "clips.json")).json();
    expect(clipsJson).toEqual(clipsToReturn);
    cp.close();
  });
});

describe("processSelectedClips", () => {
  test("processes only the given clips (including a custom one) and completes the run", async () => {
    const cp = new CheckpointManager(":memory:");
    await runUntilSelection(cp, "https://youtube.com/watch?v=vid-1");
    const runId = cp.listRuns()[0]!.id;
    callLog.length = 0;

    const customClip: ClipCandidate = {
      id: "custom-1",
      title: "Custom Clip",
      hookLine: "hook",
      startSec: 10,
      endSec: 40,
      reason: "manual",
      viralScore: 0,
      tags: [],
    };
    const selected = [...fixtureClips(1), customClip];

    await processSelectedClips(cp, runId, selected);

    expect(callLog.filter((c) => c === "extract")).toHaveLength(2);
    expect(cp.getRun(runId)!.status).toBe("completed");

    const clipsJson = await Bun.file(join(config.runsDir, runId, "clips.json")).json();
    expect(clipsJson).toEqual(selected);
    cp.close();
  });

  test("keeps unselected AI candidates in clips.json instead of dropping them", async () => {
    clipsToReturn = fixtureClips(3);
    const cp = new CheckpointManager(":memory:");
    await runUntilSelection(cp, "https://youtube.com/watch?v=vid-1");
    const runId = cp.listRuns()[0]!.id;
    callLog.length = 0;

    // First export: render just clip-0. clip-1/clip-2 were identified but not picked.
    await processSelectedClips(cp, runId, [clipsToReturn[0]!]);
    let clipsJson = (await Bun.file(join(config.runsDir, runId, "clips.json")).json()) as ClipCandidate[];
    expect(clipsJson.map((c) => c.id).sort()).toEqual(["clip-0", "clip-1", "clip-2"]);

    // Second export, later: render clip-1 too. clip-0 and clip-2 must still be there.
    await processSelectedClips(cp, runId, [clipsToReturn[1]!]);
    clipsJson = (await Bun.file(join(config.runsDir, runId, "clips.json")).json()) as ClipCandidate[];
    expect(clipsJson.map((c) => c.id).sort()).toEqual(["clip-0", "clip-1", "clip-2"]);

    cp.close();
  });

  test("re-renders overlay + compose (no Whisper) when re-selecting with a different style", async () => {
    const cp = new CheckpointManager(":memory:");
    await runUntilSelection(cp, "https://youtube.com/watch?v=vid-1");
    const runId = cp.listRuns()[0]!.id;
    await processSelectedClips(cp, runId, fixtureClips(1));
    callLog.length = 0;

    const differentStyle: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, fontSize: 44, position: "center" };
    await processSelectedClips(cp, runId, fixtureClips(1), differentStyle);

    expect(callLog).toEqual(["regen-caption", "compose"]);
    expect(cp.getRun(runId)!.status).toBe("completed");
    const captionsJson = await Bun.file(join(config.runsDir, runId, "clips", "clip-0", "captions.json")).json();
    expect(captionsJson.style).toEqual(differentStyle);
    cp.close();
  });

  test("re-renders overlay + compose when re-selecting with different pre-production choices", async () => {
    const cp = new CheckpointManager(":memory:");
    await runUntilSelection(cp, "https://youtube.com/watch?v=vid-1");
    const runId = cp.listRuns()[0]!.id;
    await processSelectedClips(cp, runId, fixtureClips(1));
    callLog.length = 0;

    // Without this staleness check, re-selecting the same clips after only toggling on a
    // watermark would look identical to the checkpoint (all 4 stages already "completed") and
    // silently skip re-rendering — the exported video would never actually gain the watermark.
    await processSelectedClips(cp, runId, fixtureClips(1), undefined, {
      watermark: { imageAsset: "logo.png", position: "bottom-right", opacity: 0.8 },
    });

    expect(callLog).toEqual(["regen-caption", "compose"]);
    expect(cp.getRun(runId)!.status).toBe("completed");
    const preproduction = await Bun.file(join(config.runsDir, runId, "preproduction.json")).json();
    expect(preproduction.watermark.imageAsset).toBe("logo.png");
    cp.close();
  });

  test("re-selecting with the same style is a no-op", async () => {
    const cp = new CheckpointManager(":memory:");
    await runUntilSelection(cp, "https://youtube.com/watch?v=vid-1");
    const runId = cp.listRuns()[0]!.id;
    await processSelectedClips(cp, runId, fixtureClips(1));
    callLog.length = 0;

    await processSelectedClips(cp, runId, fixtureClips(1));

    expect(callLog).toEqual([]);
    cp.close();
  });
});

describe("regenerateCaptionOverlay", () => {
  test("re-renders overlay + compose only, without re-extracting or re-desilencing", async () => {
    const cp = new CheckpointManager(":memory:");
    await runUntilSelection(cp, "https://youtube.com/watch?v=vid-1");
    const runId = cp.listRuns()[0]!.id;
    await processSelectedClips(cp, runId, fixtureClips(1));
    callLog.length = 0;

    const editedGroups: CaptionGroup[] = [{ words: [{ word: "hi", start: 0, end: 0.5 }], start: 0, end: 0.5 }];

    await regenerateCaptionOverlay(cp, runId, "clip-0", editedGroups);

    expect(callLog).toEqual(["regen-caption", "compose"]);

    const progress = cp.getClipProgress(runId);
    expect(progress.find((p) => p.stage === "EXTRACT_CLIPS")?.status).toBe("completed");
    expect(progress.find((p) => p.stage === "REMOVE_SILENCE")?.status).toBe("completed");
    expect(progress.find((p) => p.stage === "GENERATE_CAPTIONS")?.status).toBe("completed");
    expect(progress.find((p) => p.stage === "COMPOSE_REEL")?.status).toBe("completed");

    const captionsJson = await Bun.file(join(config.runsDir, runId, "clips", "clip-0", "captions.json")).json();
    expect(captionsJson).toEqual({ groups: editedGroups, style: DEFAULT_CAPTION_STYLE });
    cp.close();
  });
});
