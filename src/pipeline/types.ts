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

export interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  primaryColor: string;
  activeColor: string;
  position: "bottom" | "center" | "top";
  animate: boolean;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontFamily: "Plus Jakarta Sans",
  fontSize: 64,
  primaryColor: "#ffffff",
  activeColor: "#c0c1ff",
  position: "bottom",
  animate: true,
};

export interface SilentInterval {
  start: number;
  end: number;
}
