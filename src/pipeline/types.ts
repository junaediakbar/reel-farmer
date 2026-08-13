export type GlobalStage = "DOWNLOAD" | "TRANSCRIBE" | "IDENTIFY_CLIPS";
export type ClipStage = "EXTRACT_CLIPS" | "REMOVE_SILENCE" | "GENERATE_CAPTIONS" | "COMPOSE_REEL";
export type StageName = GlobalStage | ClipStage;

export const GLOBAL_STAGES: GlobalStage[] = ["DOWNLOAD", "TRANSCRIBE", "IDENTIFY_CLIPS"];
export const CLIP_STAGES: ClipStage[] = ["EXTRACT_CLIPS", "REMOVE_SILENCE", "GENERATE_CAPTIONS", "COMPOSE_REEL"];

export type StageStatus = "pending" | "running" | "completed" | "failed";

/** "awaiting_selection" is reachable once a review UI exists; the CLI's full-auto `pipeline` never produces it. */
export type RunStatus = "pending" | "running" | "awaiting_selection" | "completed" | "failed";

export interface PipelineRun {
  id: string;
  videoId: string;
  videoUrl: string;
  title: string | null;
  status: RunStatus;
  currentStage: StageName | null;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
}

/** User-editable per-run knobs from the create-run form. Persisted to runDir/options.json so retries/resumes reuse the same choices. */
export interface RunOptions {
  contentType?: string;
  /** Per-run override of the global AI provider (Settings) for IDENTIFY_CLIPS — unset means use the Settings choice. */
  aiProvider?: "deepseek" | "nvidia";
  language?: string;
  clipCount?: number;
  minDurationSec?: number;
  maxDurationSec?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StageResult {
  runId: string;
  stage: StageName;
  status: StageStatus;
  startedAt: string | null;
  completedAt: string | null;
  resultJson: string | null;
  errorMessage: string | null;
}

export interface ClipProgress {
  id: string;
  runId: string;
  clipId: string;
  stage: ClipStage;
  status: StageStatus;
  startedAt: string | null;
  completedAt: string | null;
  outputPath: string | null;
  errorMessage: string | null;
}

export interface ClipCandidate {
  id: string;
  title: string;
  hookLine: string;
  startSec: number;
  endSec: number;
  reason: string;
  viralScore: number;
  tags: string[];
}

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

export interface Transcript {
  source: "youtube" | "whisper";
  segments: TranscriptSegment[];
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface CaptionGroup {
  words: WordTimestamp[];
  start: number;
  end: number;
}

/** COMPOSE_REEL keys this exact green out of the caption overlay to composite it over the source
 * footage (composer.ts's `colorkey=0x00ff00:0.02:0.65` — keep the hex in sync with that filter, and
 * CaptionOverlay.tsx's chroma-key background). A caption color picked close enough to this green
 * gets keyed out too, punching transparent holes in the rendered text. */
export const CHROMA_KEY = "#00ff00";

// Mirrors composer.ts's colorkey similarity — keep numbers in sync with that filter string.
const CHROMA_KEY_SIMILARITY = 0.02;

// A caption color's anti-aliased edge linearly interpolates toward pure green as glyph coverage
// drops, so a pixel goes fully transparent once it's more than (1 - CHROMA_KEY_SIMILARITY/dist)
// green-blended. Requiring that only the innermost 20% of that gradient (nearest pure green) can
// vanish keeps the glyph shape intact; solving for dist gives this floor.
const MAX_ERODED_EDGE_FRACTION = 0.2;
const CHROMA_KEY_RADIUS = CHROMA_KEY_SIMILARITY / MAX_ERODED_EDGE_FRACTION;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** True if `hex` falls inside the export chroma-keyer's erosion-safety radius around CHROMA_KEY —
 * picking it for caption text would visibly eat into glyph edges (or, for near-exact greens,
 * disappear outright) in the rendered video. */
export function isTooCloseToChromaKey(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  const [kr, kg, kb] = hexToRgb(CHROMA_KEY);
  const dist = Math.sqrt((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2) / (255 * Math.sqrt(3));
  return dist <= CHROMA_KEY_RADIUS;
}

export interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  outline: boolean;
  primaryColor: string;
  activeColor: string;
  position: "bottom" | "center" | "top";
  animate: boolean;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontFamily: "Arial",
  fontSize: 52,
  fontWeight: 800,
  lineHeight: 1.1,
  outline: true,
  primaryColor: "#ffffff",
  activeColor: "#FFD700",
  position: "center",
  animate: true,
};

/** Splits a caption group's words into up to 2 fixed lines at the midpoint (short groups fall back
 * to 1 line — line2 is empty). Matches the reference render style's layout. Shared by
 * `CaptionOverlay.tsx` (export render) and `CaptionEditor.tsx` (live preview) on purpose — they
 * must never compute this independently, or preview and export silently drift apart. */
export function splitCaptionLines(words: WordTimestamp[]): [WordTimestamp[], WordTimestamp[]] {
  const midpoint = Math.ceil(words.length / 2);
  return [words.slice(0, midpoint), words.slice(midpoint)];
}

/** Shape persisted to captions.json — groups alongside the style they were rendered with, so reopening the editor restores both. */
export interface CaptionsFile {
  groups: CaptionGroup[];
  style: CaptionStyle;
}

export interface SilentInterval {
  start: number;
  end: number;
}

export type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

/** Wire/persisted shape — imageAsset is an opaque server-generated filename under runDir/assets,
 * never a client-supplied path (see the upload endpoint in server.ts). */
export interface WatermarkOptions {
  imageAsset: string;
  position: WatermarkPosition;
  opacity: number;
}

export interface EndingWatermarkOptions extends WatermarkOptions {
  /** Watermark shows only in the last N seconds of the clip. */
  durationSec: number;
}

/** Pre-Production panel choices (PRD §1.5/§7.1, G19) — persisted to runDir/preproduction.json
 * alongside style.json. Every field optional/off by default per PRD Principle #1. */
export interface PreProductionOptions {
  thumbnailAsset?: string;
  thumbnailFrameSec?: number;
  watermark?: WatermarkOptions;
  endingWatermark?: EndingWatermarkOptions;
}
