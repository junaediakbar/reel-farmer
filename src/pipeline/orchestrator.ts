import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";
import { log } from "../logger";
import { composeReel } from "../modules/composer";
import { downloadVideo, type DownloadResult } from "../modules/downloader";
import { extractClip } from "../modules/extractor";
import { generateCaptions, renderCaptionOverlay } from "../modules/caption-generator";
import { detectSilence, removeSilence } from "../modules/silence-remover";
import { identifyClips } from "../modules/clip-identifier";
import { getTranscript } from "../modules/transcriber";
import { CheckpointManager, type ResumableState } from "./checkpoint";
import { Semaphore } from "./semaphore";
import {
  DEFAULT_CAPTION_STYLE,
  type CaptionGroup,
  type CaptionStyle,
  type ClipCandidate,
  type ClipStage,
  type Transcript,
} from "./types";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").slice(0, 60);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await Bun.write(path, JSON.stringify(value));
}

async function readJson<T>(path: string): Promise<T> {
  return (await Bun.file(path).json()) as T;
}

export function finalClipPath(outputDir: string, clip: ClipCandidate): string {
  return join(outputDir, `${sanitizeFilename(clip.title)}-${clip.id.slice(0, 8)}.mp4`);
}

/** Sets up (or resumes) a run's working dir + checkpoint row; shared by `runPipeline` and `runUntilSelection`. */
function initRun(checkpoint: CheckpointManager, videoUrl: string, resumeRunId?: string) {
  const runId = resumeRunId ?? crypto.randomUUID();
  const runDir = join(config.runsDir, runId);
  mkdirSync(runDir, { recursive: true });

  let run = checkpoint.getRun(runId);
  if (!run) run = checkpoint.createRun(runId, "", videoUrl, null);

  const resumable = checkpoint.getResumableState(runId);
  return { runId, runDir, resumable };
}

function failRun(checkpoint: CheckpointManager, runId: string, err: unknown): never {
  const message = errMsg(err);
  checkpoint.updateRunStatus(runId, "failed", checkpoint.getRun(runId)?.currentStage ?? null, message);
  log("error", "run failed", { runId, error: message });
  throw err;
}

async function processClip(
  checkpoint: CheckpointManager,
  runId: string,
  runDir: string,
  outputDir: string,
  downloadResult: DownloadResult,
  transcript: Transcript,
  clip: ClipCandidate,
  resumable: ResumableState,
): Promise<void> {
  const clipDir = join(runDir, "clips", clip.id);
  mkdirSync(clipDir, { recursive: true });
  const completed = resumable.clips.get(clip.id) ?? new Set<ClipStage>();

  async function runStage(stage: ClipStage, outputPath: string, run: () => Promise<void>): Promise<void> {
    if (completed.has(stage)) {
      log("info", "skip completed clip stage", { runId, stage, clipId: clip.id });
      return;
    }
    checkpoint.startClipStage(runId, clip.id, stage);
    try {
      await run();
      checkpoint.completeClipStage(runId, clip.id, stage, outputPath);
    } catch (err) {
      checkpoint.failClipStage(runId, clip.id, stage, errMsg(err));
      throw err;
    }
  }

  const rawClipPath = join(clipDir, "raw.mp4");
  await runStage("EXTRACT_CLIPS", rawClipPath, () => extractClip(downloadResult.videoPath, clip.startSec, clip.endSec, rawClipPath));

  const desilencedPath = join(clipDir, "desilenced.mp4");
  await runStage("REMOVE_SILENCE", desilencedPath, async () => {
    const silent = await detectSilence(rawClipPath);
    await removeSilence(rawClipPath, silent, desilencedPath);
  });

  const overlayPath = join(clipDir, "overlay.mp4");
  await runStage("GENERATE_CAPTIONS", overlayPath, () => {
    const referenceText = transcript.segments
      .filter((s) => s.end > clip.startSec && s.start < clip.endSec)
      .map((s) => s.text)
      .join(" ");
    return generateCaptions(desilencedPath, clipDir, referenceText, overlayPath, DEFAULT_CAPTION_STYLE, { runId, clipId: clip.id });
  });

  const finalPath = finalClipPath(outputDir, clip);
  await runStage("COMPOSE_REEL", finalPath, () => composeReel(desilencedPath, overlayPath, finalPath));
}

/** Semaphore-bounded EXTRACT_CLIPS..COMPOSE_REEL over `clips`; shared by full-auto and review-flow paths. Throws only if every clip failed. */
async function runClipStages(
  checkpoint: CheckpointManager,
  runId: string,
  runDir: string,
  outputDir: string,
  downloadResult: DownloadResult,
  transcript: Transcript,
  clips: ClipCandidate[],
  resumable: ResumableState,
): Promise<{ failedCount: number }> {
  const semaphore = new Semaphore(config.maxParallelClips);
  const results = await Promise.allSettled(
    clips.map((clip) =>
      semaphore.run(() => processClip(checkpoint, runId, runDir, outputDir, downloadResult, transcript, clip, resumable)),
    ),
  );

  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed.length > 0) {
    for (const f of failed) log("error", "clip failed", { runId, error: errMsg(f.reason) });
  }
  if (clips.length > 0 && failed.length === clips.length) {
    throw new Error(`All ${clips.length} clip(s) failed`);
  }
  return { failedCount: failed.length };
}

/** DOWNLOAD -> TRANSCRIBE -> IDENTIFY_CLIPS, resuming whatever's already completed. Shared by `runPipeline` and `runUntilSelection`. */
async function runGlobalStages(
  checkpoint: CheckpointManager,
  runId: string,
  runDir: string,
  videoUrl: string,
  resumable: ResumableState,
): Promise<{ downloadResult: DownloadResult; transcript: Transcript; clips: ClipCandidate[] }> {
  let downloadResult: DownloadResult;
  if (resumable.completedGlobalStages.has("DOWNLOAD")) {
    log("info", "skip completed stage", { runId, stage: "DOWNLOAD" });
    downloadResult = await readJson<DownloadResult>(join(runDir, "download-result.json"));
  } else {
    checkpoint.updateRunStatus(runId, "running", "DOWNLOAD");
    checkpoint.startStage(runId, "DOWNLOAD");
    downloadResult = await downloadVideo(runDir, videoUrl);
    checkpoint.setRunVideoInfo(runId, downloadResult.videoId, downloadResult.title);
    await writeJson(join(runDir, "download-result.json"), downloadResult);
    checkpoint.completeStage(runId, "DOWNLOAD", JSON.stringify(downloadResult));
  }

  let transcript: Transcript;
  if (resumable.completedGlobalStages.has("TRANSCRIBE")) {
    log("info", "skip completed stage", { runId, stage: "TRANSCRIBE" });
    transcript = await readJson<Transcript>(join(runDir, "transcript.json"));
  } else {
    checkpoint.updateRunStatus(runId, "running", "TRANSCRIBE");
    checkpoint.startStage(runId, "TRANSCRIBE");
    transcript = await getTranscript(runDir, downloadResult.videoPath, downloadResult.subtitlePath);
    await writeJson(join(runDir, "transcript.json"), transcript);
    checkpoint.completeStage(runId, "TRANSCRIBE", JSON.stringify({ source: transcript.source, segments: transcript.segments.length }));
  }

  let clips: ClipCandidate[];
  if (resumable.completedGlobalStages.has("IDENTIFY_CLIPS")) {
    log("info", "skip completed stage", { runId, stage: "IDENTIFY_CLIPS" });
    clips = await readJson<ClipCandidate[]>(join(runDir, "clips.json"));
  } else {
    checkpoint.updateRunStatus(runId, "running", "IDENTIFY_CLIPS");
    checkpoint.startStage(runId, "IDENTIFY_CLIPS");
    const identified = await identifyClips(transcript, downloadResult.durationSec);
    clips = identified.clips;
    await writeJson(join(runDir, "clips.json"), clips);
    checkpoint.completeStage(
      runId,
      "IDENTIFY_CLIPS",
      JSON.stringify({ count: clips.length, tokenUsage: identified.tokenUsage }),
    );
  }

  return { downloadResult, transcript, clips };
}

/** Runs (or resumes) one full video through all 7 PRD stages, full-auto — no pause for manual clip selection (PRD §3.1: `pipeline <url>` runs "tanpa berhenti untuk review"). */
export async function runPipeline(checkpoint: CheckpointManager, videoUrl: string, resumeRunId?: string): Promise<void> {
  const { runId, runDir, resumable } = initRun(checkpoint, videoUrl, resumeRunId);
  log("info", "run started", { runId, videoUrl, resuming: Boolean(resumeRunId) });

  try {
    const { downloadResult, transcript, clips } = await runGlobalStages(checkpoint, runId, runDir, videoUrl, resumable);

    checkpoint.updateRunStatus(runId, "running", "EXTRACT_CLIPS");
    const outputDir = join(config.outputDir, downloadResult.videoId);
    mkdirSync(outputDir, { recursive: true });

    const { failedCount } = await runClipStages(checkpoint, runId, runDir, outputDir, downloadResult, transcript, clips, resumable);

    checkpoint.updateRunStatus(runId, "completed", null);
    log("info", "run completed", { runId, clips: clips.length, failedClips: failedCount });
  } catch (err) {
    failRun(checkpoint, runId, err);
  }
}

/** Runs DOWNLOAD -> TRANSCRIBE -> IDENTIFY_CLIPS only, then stops at `awaiting_selection` for a review UI to pick clips (PRD §2.3). */
export async function runUntilSelection(checkpoint: CheckpointManager, videoUrl: string, resumeRunId?: string): Promise<void> {
  const { runId, runDir, resumable } = initRun(checkpoint, videoUrl, resumeRunId);
  log("info", "run started (awaiting selection)", { runId, videoUrl, resuming: Boolean(resumeRunId) });

  try {
    await runGlobalStages(checkpoint, runId, runDir, videoUrl, resumable);
    checkpoint.updateRunStatus(runId, "awaiting_selection", null);
    log("info", "run awaiting selection", { runId });
  } catch (err) {
    failRun(checkpoint, runId, err);
  }
}

/**
 * Resumes a run past `awaiting_selection` with the caller's final clip list — selected candidates
 * (possibly trimmed) plus any custom/imported clips. Overwrites `clips.json` with that list, then
 * runs EXTRACT_CLIPS..COMPOSE_REEL for exactly those clips (checkpoint state still skips any
 * per-clip stage already completed for a given clip id, so re-selecting after a partial failure
 * only redoes what's missing).
 */
export async function processSelectedClips(
  checkpoint: CheckpointManager,
  runId: string,
  selectedClips: ClipCandidate[],
): Promise<void> {
  const runDir = join(config.runsDir, runId);
  const downloadResult = await readJson<DownloadResult>(join(runDir, "download-result.json"));
  const transcript = await readJson<Transcript>(join(runDir, "transcript.json"));
  await writeJson(join(runDir, "clips.json"), selectedClips);

  const resumable = checkpoint.getResumableState(runId);
  log("info", "processing selected clips", { runId, count: selectedClips.length });

  try {
    checkpoint.updateRunStatus(runId, "running", "EXTRACT_CLIPS");
    const outputDir = join(config.outputDir, downloadResult.videoId);
    mkdirSync(outputDir, { recursive: true });

    const { failedCount } = await runClipStages(
      checkpoint,
      runId,
      runDir,
      outputDir,
      downloadResult,
      transcript,
      selectedClips,
      resumable,
    );

    checkpoint.updateRunStatus(runId, "completed", null);
    log("info", "run completed", { runId, clips: selectedClips.length, failedClips: failedCount });
  } catch (err) {
    failRun(checkpoint, runId, err);
  }
}

/**
 * Re-renders only the caption overlay + final compose for one already-extracted/desilenced clip,
 * from edited word groups — skips Whisper and re-extraction entirely (the caption editor's
 * "regenerate" action, PRD §3.3).
 */
export async function regenerateCaptionOverlay(
  checkpoint: CheckpointManager,
  runId: string,
  clipId: string,
  editedGroups: CaptionGroup[],
  style: CaptionStyle = DEFAULT_CAPTION_STYLE,
): Promise<void> {
  const runDir = join(config.runsDir, runId);
  const clipDir = join(runDir, "clips", clipId);
  const desilencedPath = join(clipDir, "desilenced.mp4");
  const overlayPath = join(clipDir, "overlay.mp4");

  const downloadResult = await readJson<DownloadResult>(join(runDir, "download-result.json"));
  const clips = await readJson<ClipCandidate[]>(join(runDir, "clips.json"));
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) throw new Error(`Clip ${clipId} not found in run ${runId}`);

  checkpoint.startClipStage(runId, clipId, "GENERATE_CAPTIONS");
  try {
    await writeJson(join(clipDir, "captions.json"), editedGroups);
    await renderCaptionOverlay(editedGroups, style, overlayPath);
    checkpoint.completeClipStage(runId, clipId, "GENERATE_CAPTIONS", overlayPath);
  } catch (err) {
    checkpoint.failClipStage(runId, clipId, "GENERATE_CAPTIONS", errMsg(err));
    throw err;
  }

  const outputDir = join(config.outputDir, downloadResult.videoId);
  const finalPath = finalClipPath(outputDir, clip);
  checkpoint.startClipStage(runId, clipId, "COMPOSE_REEL");
  try {
    await composeReel(desilencedPath, overlayPath, finalPath);
    checkpoint.completeClipStage(runId, clipId, "COMPOSE_REEL", finalPath);
  } catch (err) {
    checkpoint.failClipStage(runId, clipId, "COMPOSE_REEL", errMsg(err));
    throw err;
  }
}
