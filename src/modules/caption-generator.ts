import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { join } from "node:path";
import { config } from "../config";
import { log } from "../logger";
import { CaptionGroup, CaptionStyle, DEFAULT_CAPTION_STYLE, WordTimestamp } from "../pipeline/types";
import { extractAudioWav, transcribeWordsWithWhisper } from "./transcriber";

const ENTRY_POINT = join(import.meta.dir, "..", "remotion", "index.tsx");

/**
 * Prefers the reference transcript's text (more accurate spelling) but keeps Whisper's per-word
 * timestamps. When word counts don't line up (misrecognition, filler words), positional mapping
 * would misalign text to the wrong timestamps, so we fall back to Whisper's own words verbatim.
 * Logs a warning on fallback (fields: runId/clipId if given, word counts) — G10: this was
 * previously silent, so drift frequency couldn't be diagnosed across devices/runs.
 * ponytail: positional-only alignment, no fuzzy/DTW matching — upgrade if drift turns out common.
 */
export function alignToReference(
  whisperWords: WordTimestamp[],
  referenceText: string,
  context: { runId?: string; clipId?: string } = {},
): WordTimestamp[] {
  const referenceWords = referenceText.trim().split(/\s+/).filter(Boolean);
  if (referenceWords.length !== whisperWords.length) {
    log("warn", "caption alignment fell back to Whisper's own words (word count mismatch)", {
      ...context,
      whisperWordCount: whisperWords.length,
      referenceWordCount: referenceWords.length,
    });
    return whisperWords;
  }
  return whisperWords.map((w, i) => ({ ...w, word: referenceWords[i]! }));
}

export function groupWords(words: WordTimestamp[], groupSize: number = config.captionWordsPerGroup): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  for (let i = 0; i < words.length; i += groupSize) {
    const chunk = words.slice(i, i + groupSize);
    if (chunk.length === 0) continue;
    groups.push({ words: chunk, start: chunk[0]!.start, end: chunk[chunk.length - 1]!.end });
  }
  return groups;
}

/** Headless-renders the karaoke caption composition to a transparent WebM. Re-bundles per call. */
export async function renderCaptionOverlay(groups: CaptionGroup[], style: CaptionStyle, outPath: string): Promise<void> {
  const serveUrl = await bundle({ entryPoint: ENTRY_POINT });
  const inputProps = { groups, style };
  const composition = await selectComposition({ serveUrl, id: "CaptionOverlay", inputProps });
  await renderMedia({
    composition,
    serveUrl,
    codec: "vp8",
    pixelFormat: "yuva420p",
    imageFormat: "png",
    outputLocation: outPath,
    inputProps,
  });
}

/** GENERATE_CAPTIONS stage: word timestamps from the (already desilenced) clip's own audio, aligned to referenceText, grouped, rendered. */
export async function generateCaptions(
  clipVideoPath: string,
  clipDir: string,
  referenceText: string,
  outOverlayPath: string,
  style: CaptionStyle = DEFAULT_CAPTION_STYLE,
  context: { runId?: string; clipId?: string } = {},
): Promise<void> {
  const audioPath = join(clipDir, "words-audio.wav");
  await extractAudioWav(clipVideoPath, audioPath);
  const whisperWords = await transcribeWordsWithWhisper(audioPath, join(clipDir, "words"));

  const offsetSec = config.captionOffsetMs / 1000;
  const offsetWords = whisperWords.map((w) => ({ ...w, start: w.start + offsetSec, end: w.end + offsetSec }));

  const aligned = alignToReference(offsetWords, referenceText, context);
  const groups = groupWords(aligned);
  // Persisted so a review UI can load/edit word timing later without re-running Whisper.
  await Bun.write(join(clipDir, "captions.json"), JSON.stringify(groups));
  await renderCaptionOverlay(groups, style, outOverlayPath);
}
