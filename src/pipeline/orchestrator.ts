import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { config } from "../config";
import { log } from "../logger";
import {
  composeReel,
  extractThumbnailFrame,
  type EndingWatermarkFilterOptions,
  type WatermarkFilterOptions,
} from "../modules/composer";
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
  type CaptionsFile,
  type ClipCandidate,
  type ClipStage,
  type EndingWatermarkOptions,
  type PreProductionOptions,
  type RunOptions,
  type Transcript,
  type WatermarkOptions,
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

/** Reads the run's persisted options (create-run form choices), or {} for runs from before this existed. */
async function readRunOptions(runDir: string): Promise<RunOptions> {
  const path = join(runDir, "options.json");
  return existsSync(path) ? readJson<RunOptions>(path) : {};
}

/** Reads the run's persisted Pre-Production choices (thumbnail/watermark/ending watermark), or {}
 * for runs before this existed / that never opted in — every field is off by default. */
async function readPreProduction(runDir: string): Promise<PreProductionOptions> {
  const path = join(runDir, "preproduction.json");
  return existsSync(path) ? readJson<PreProductionOptions>(path) : {};
}

/** Resolves a persisted watermark's opaque asset filename to its absolute path under runDir/assets.
 * basename() strips any directory components even though the name is server-generated (defense in
 * depth, not trust) — see the upload endpoint in server.ts for where the name is minted. */
function resolveWatermark(runDir: string, watermark?: WatermarkOptions): WatermarkFilterOptions | undefined {
  // No asset uploaded yet (panel toggled on but nothing picked) — treat as off rather than
  // pointing ffmpeg at the empty-string path (the assets dir itself), which fails the whole render.
  if (!watermark?.imageAsset) return undefined;
  return { imagePath: join(runDir, "assets", basename(watermark.imageAsset)), position: watermark.position, opacity: watermark.opacity };
}

function resolveEndingWatermark(runDir: string, watermark?: EndingWatermarkOptions): EndingWatermarkFilterOptions | undefined {
  if (!watermark?.imageAsset) return undefined;
  return { ...resolveWatermark(runDir, watermark)!, durationSec: watermark.durationSec };
}

/** Writes the clip's thumbnail if the user opted into one — a custom upload wins over a frame pick;
 * neither set means no thumbnail file, matching PRD's "opsional, default off" for the whole panel. */
async function writeThumbnail(
  runDir: string,
  outputDir: string,
  clip: ClipCandidate,
  finalPath: string,
  preProduction: PreProductionOptions,
): Promise<void> {
  const thumbPath = finalThumbnailPath(outputDir, clip);
  if (preProduction.thumbnailAsset) {
    await Bun.write(thumbPath, Bun.file(join(runDir, "assets", basename(preProduction.thumbnailAsset))));
  } else if (preProduction.thumbnailFrameSec !== undefined) {
    await extractThumbnailFrame(finalPath, preProduction.thumbnailFrameSec, thumbPath);
  }
}

export function finalClipPath(outputDir: string, clip: ClipCandidate): string {
  return join(outputDir, `${sanitizeFilename(clip.title)}-${clip.id.slice(0, 8)}.mp4`);
}

/** Thumbnail sidecar for a rendered clip — same base name, .jpg extension, same dir. */
export function finalThumbnailPath(outputDir: string, clip: ClipCandidate): string {
  return finalClipPath(outputDir, clip).replace(/\.mp4$/, ".jpg");
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
  language?: string,
  style: CaptionStyle = DEFAULT_CAPTION_STYLE,
  preProduction: PreProductionOptions = {},
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
    return generateCaptions(desilencedPath, clipDir, referenceText, overlayPath, style, { runId, clipId: clip.id }, language);
  });

  const finalPath = finalClipPath(outputDir, clip);
  await runStage("COMPOSE_REEL", finalPath, async () => {
    await composeReel(
      desilencedPath,
      overlayPath,
      finalPath,
      resolveWatermark(runDir, preProduction.watermark),
      resolveEndingWatermark(runDir, preProduction.endingWatermark),
    );
    await writeThumbnail(runDir, outputDir, clip, finalPath, preProduction);
  });
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
  language?: string,
  style: CaptionStyle = DEFAULT_CAPTION_STYLE,
  preProduction: PreProductionOptions = {},
): Promise<{ failedCount: number }> {
  const semaphore = new Semaphore(config.maxParallelClips);
  const results = await Promise.allSettled(
    clips.map((clip) =>
      semaphore.run(() =>
        processClip(checkpoint, runId, runDir, outputDir, downloadResult, transcript, clip, resumable, language, style, preProduction),
      ),
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
  requestedOptions: RunOptions = {},
): Promise<{ downloadResult: DownloadResult; transcript: Transcript; clips: ClipCandidate[]; options: RunOptions }> {
  // Persisted once on first run so retries/resumes (which don't re-send the create-run form)
  // reuse the same language/type/count/duration choices instead of silently falling back to defaults.
  const optionsPath = join(runDir, "options.json");
  const options = existsSync(optionsPath) ? await readJson<RunOptions>(optionsPath) : requestedOptions;
  if (!existsSync(optionsPath)) await writeJson(optionsPath, options);

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
    transcript = await getTranscript(runDir, downloadResult.videoPath, downloadResult.subtitlePath, options.language);
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
    const identified = await identifyClips(transcript, downloadResult.durationSec, options);
    clips = identified.clips;
    await writeJson(join(runDir, "clips.json"), clips);
    checkpoint.completeStage(
      runId,
      "IDENTIFY_CLIPS",
      JSON.stringify({ count: clips.length, tokenUsage: identified.tokenUsage }),
    );
  }

  return { downloadResult, transcript, clips, options };
}

/** Runs (or resumes) one full video through all 7 PRD stages, full-auto — no pause for manual clip selection (PRD §3.1: `pipeline <url>` runs "tanpa berhenti untuk review"). */
export async function runPipeline(
  checkpoint: CheckpointManager,
  videoUrl: string,
  resumeRunId?: string,
  options: RunOptions = {},
): Promise<void> {
  const { runId, runDir, resumable } = initRun(checkpoint, videoUrl, resumeRunId);
  log("info", "run started", { runId, videoUrl, resuming: Boolean(resumeRunId) });

  try {
    const { downloadResult, transcript, clips, options: resolvedOptions } = await runGlobalStages(
      checkpoint,
      runId,
      runDir,
      videoUrl,
      resumable,
      options,
    );

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
      clips,
      resumable,
      resolvedOptions.language,
    );

    checkpoint.updateRunStatus(runId, "completed", null);
    log("info", "run completed", { runId, clips: clips.length, failedClips: failedCount });
  } catch (err) {
    failRun(checkpoint, runId, err);
  }
}

/** Runs DOWNLOAD -> TRANSCRIBE -> IDENTIFY_CLIPS only, then stops at `awaiting_selection` for a review UI to pick clips (PRD §2.3). */
export async function runUntilSelection(
  checkpoint: CheckpointManager,
  videoUrl: string,
  resumeRunId?: string,
  options: RunOptions = {},
): Promise<void> {
  const { runId, runDir, resumable } = initRun(checkpoint, videoUrl, resumeRunId);
  log("info", "run started (awaiting selection)", { runId, videoUrl, resuming: Boolean(resumeRunId) });

  try {
    await runGlobalStages(checkpoint, runId, runDir, videoUrl, resumable, options);
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
 *
 * `style` is the caption style to render new clips with. It's persisted to `style.json` so retries
 * reuse it; clips that were already rendered with a *different* style are fast-re-rendered (overlay
 * + compose only, reusing their word groups — no Whisper re-run), instead of being silently skipped
 * by the checkpoint.
 */
export async function processSelectedClips(
  checkpoint: CheckpointManager,
  runId: string,
  selectedClips: ClipCandidate[],
  style?: CaptionStyle,
  preProduction?: PreProductionOptions,
): Promise<void> {
  const runDir = join(config.runsDir, runId);
  const downloadResult = await readJson<DownloadResult>(join(runDir, "download-result.json"));
  const transcript = await readJson<Transcript>(join(runDir, "transcript.json"));
  const options = await readRunOptions(runDir);

  const stylePath = join(runDir, "style.json");
  const resolvedStyle = style ?? (existsSync(stylePath) ? await readJson<CaptionStyle>(stylePath) : DEFAULT_CAPTION_STYLE);
  if (style) await writeJson(stylePath, style);

  const preproductionPath = join(runDir, "preproduction.json");
  const existingPreProduction = await readPreProduction(runDir);
  const resolvedPreProduction = preProduction ?? existingPreProduction;
  if (preProduction) await writeJson(preproductionPath, preProduction);

  // Merge into clips.json, don't overwrite it: selectedClips is just this export's picks, but
  // clips.json is the durable record of every AI candidate + custom clip ever seen for this run —
  // overwriting would permanently drop AI suggestions the user didn't render this round, making
  // them unviewable and unrenderable later.
  const clipsJsonPath = join(runDir, "clips.json");
  const existingClips = existsSync(clipsJsonPath) ? await readJson<ClipCandidate[]>(clipsJsonPath) : [];
  const byId = new Map(existingClips.map((c) => [c.id, c]));
  for (const c of selectedClips) byId.set(c.id, c);
  await writeJson(clipsJsonPath, [...byId.values()]);

  // Clips with existing captions rendered in another style get a cheap overlay+compose re-render
  // (their word timings are still good); the rest go through the normal stage pipeline.
  const reRender: Array<{ clip: ClipCandidate; groups: CaptionGroup[] }> = [];
  const fresh: ClipCandidate[] = [];
  for (const clip of selectedClips) {
    const captionsPath = join(runDir, "clips", clip.id, "captions.json");
    if (existsSync(captionsPath)) {
      const existing = await readJson<CaptionsFile>(captionsPath);
      const styleChanged = JSON.stringify(existing.style) !== JSON.stringify(resolvedStyle);
      const preProductionChanged = JSON.stringify(existingPreProduction) !== JSON.stringify(resolvedPreProduction);
      if (styleChanged || preProductionChanged) {
        reRender.push({ clip, groups: existing.groups });
        continue;
      }
    }
    fresh.push(clip);
  }

  const resumable = checkpoint.getResumableState(runId);
  log("info", "processing selected clips", { runId, count: selectedClips.length, styleChanged: reRender.length > 0 });

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
      fresh,
      resumable,
      options.language,
      resolvedStyle,
      resolvedPreProduction,
    );

    for (const { clip, groups } of reRender) {
      await regenerateCaptionOverlay(checkpoint, runId, clip.id, groups, resolvedStyle);
    }

    checkpoint.updateRunStatus(runId, "completed", null);
    log("info", "run completed", { runId, clips: selectedClips.length, failedClips: failedCount });
  } catch (err) {
    failRun(checkpoint, runId, err);
  }
}

/** Loads the two files every caption-editor action needs: the run's download result and the target clip. */
async function loadClipContext(
  runDir: string,
  clipId: string,
): Promise<{ downloadResult: DownloadResult; clip: ClipCandidate }> {
  const downloadResult = await readJson<DownloadResult>(join(runDir, "download-result.json"));
  const clips = await readJson<ClipCandidate[]>(join(runDir, "clips.json"));
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) throw new Error(`Clip ${clipId} not found in ${runDir}`);
  return { downloadResult, clip };
}

/** Re-composes the final clip from the (already re-rendered) overlay — shared by regenerate and retranscribe. */
async function composeAfterCaptionChange(
  checkpoint: CheckpointManager,
  runId: string,
  clipId: string,
  downloadResult: DownloadResult,
  clip: ClipCandidate,
  desilencedPath: string,
  overlayPath: string,
): Promise<void> {
  const runDir = join(config.runsDir, runId);
  const outputDir = join(config.outputDir, downloadResult.videoId);
  const finalPath = finalClipPath(outputDir, clip);
  // Read from disk rather than accepting a param: caption-editor callers (regenerate/retranscribe)
  // never send pre-production choices, so without this a caption edit would silently strip the watermark.
  const preProduction = await readPreProduction(runDir);
  checkpoint.startClipStage(runId, clipId, "COMPOSE_REEL");
  try {
    await composeReel(
      desilencedPath,
      overlayPath,
      finalPath,
      resolveWatermark(runDir, preProduction.watermark),
      resolveEndingWatermark(runDir, preProduction.endingWatermark),
    );
    await writeThumbnail(runDir, outputDir, clip, finalPath, preProduction);
    checkpoint.completeClipStage(runId, clipId, "COMPOSE_REEL", finalPath);
  } catch (err) {
    checkpoint.failClipStage(runId, clipId, "COMPOSE_REEL", errMsg(err));
    throw err;
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

  const { downloadResult, clip } = await loadClipContext(runDir, clipId);

  checkpoint.startClipStage(runId, clipId, "GENERATE_CAPTIONS");
  try {
    await writeJson(join(clipDir, "captions.json"), { groups: editedGroups, style });
    await renderCaptionOverlay(editedGroups, style, overlayPath);
    checkpoint.completeClipStage(runId, clipId, "GENERATE_CAPTIONS", overlayPath);
  } catch (err) {
    checkpoint.failClipStage(runId, clipId, "GENERATE_CAPTIONS", errMsg(err));
    throw err;
  }

  await composeAfterCaptionChange(checkpoint, runId, clipId, downloadResult, clip, desilencedPath, overlayPath);
}

/**
 * Re-runs Whisper word-timestamp transcription on the clip's own (already-desilenced) audio in a
 * different language, then re-renders overlay + composes — the caption editor's "wrong language"
 * fix. No reference text is passed: the original run-level transcript was produced with the same
 * (wrong) language, so aligning to it would just reintroduce the mistake — alignToReference falls
 * back to Whisper's own words whenever reference/Whisper word counts don't match, which an empty
 * reference always triggers.
 */
export async function retranscribeCaptionOverlay(
  checkpoint: CheckpointManager,
  runId: string,
  clipId: string,
  language: string,
  style: CaptionStyle = DEFAULT_CAPTION_STYLE,
): Promise<void> {
  const runDir = join(config.runsDir, runId);
  const clipDir = join(runDir, "clips", clipId);
  const desilencedPath = join(clipDir, "desilenced.mp4");
  const overlayPath = join(clipDir, "overlay.mp4");

  const { downloadResult, clip } = await loadClipContext(runDir, clipId);

  checkpoint.startClipStage(runId, clipId, "GENERATE_CAPTIONS");
  try {
    await generateCaptions(desilencedPath, clipDir, "", overlayPath, style, { runId, clipId }, language);
    checkpoint.completeClipStage(runId, clipId, "GENERATE_CAPTIONS", overlayPath);
  } catch (err) {
    checkpoint.failClipStage(runId, clipId, "GENERATE_CAPTIONS", errMsg(err));
    throw err;
  }

  await composeAfterCaptionChange(checkpoint, runId, clipId, downloadResult, clip, desilencedPath, overlayPath);
}
