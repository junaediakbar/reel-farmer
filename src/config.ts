import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir, platform } from "node:os";

/** Cross-platform per-user app data dir for downloaded tool binaries — separate from the dev-tree data/models dirs. */
function appDataDir(): string {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return resolve(home, "Library", "Application Support", "reel-farmer");
    case "win32":
      return resolve(process.env.APPDATA ?? resolve(home, "AppData", "Roaming"), "reel-farmer");
    default:
      return resolve(process.env.XDG_DATA_HOME ?? resolve(home, ".local", "share"), "reel-farmer");
  }
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  root: process.cwd(),
  dataDir: resolve(process.cwd(), "data"),
  runsDir: resolve(process.cwd(), "data", "runs"),
  outputDir: resolve(process.cwd(), "output"),
  checkpointDbPath: resolve(process.cwd(), "data", "checkpoints.db"),
  modelsDir: resolve(process.cwd(), "models"),
  binDir: process.env.REEL_FARMER_BIN_DIR ?? resolve(appDataDir(), "bin"),

  deepseekApiUrl: process.env.DEEPSEEK_API_URL ?? "https://api.deepseek.com/chat/completions",

  maxParallelClips: num(process.env.MAX_PARALLEL_CLIPS, 3),
  clipSpeed: num(process.env.CLIP_SPEED, 1.2),
  silenceThresholdDb: num(process.env.SILENCE_THRESHOLD_DB, -30),
  silenceMinDuration: num(process.env.SILENCE_MIN_DURATION, 0.5),
  whisperModelPath: process.env.WHISPER_MODEL ?? resolve(process.cwd(), "models", "ggml-base.en.bin"),
  whisperLanguage: process.env.WHISPER_LANGUAGE ?? "en",
  captionAnimate: bool(process.env.CAPTION_ANIMATE, true),
  captionOffsetMs: num(process.env.CAPTION_OFFSET_MS, 0),
  webPort: num(process.env.WEB_PORT, 3001),
  preferYouTubeTranscripts: bool(process.env.PREFER_YOUTUBE_TRANSCRIPTS, true),

  minClipDurationSec: 15,
  maxClipDurationSec: 120,
  captionWordsPerGroup: 6,
};

/**
 * Called only where a DeepSeek call is about to happen — not at startup, so read-only commands
 * (status/clean) work without a key. Reads process.env live (not the config snapshot) so tests
 * can set DEEPSEEK_API_KEY per-test regardless of when config.ts was first imported.
 */
export function requireDeepSeekApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. Add it to your .env before running a pipeline that identifies clips (BYOK — this is your own DeepSeek key, not provided by Reel Farmer).",
    );
  }
  return key;
}

/**
 * Optional shared-secret gate for the web dashboard (G2: it otherwise has no auth at all).
 * Unset by default — desktop app is localhost-only, single-user. Reads process.env live so
 * tests can set/unset DASHBOARD_AUTH_TOKEN per-test regardless of when config.ts was first imported.
 */
export function dashboardAuthToken(): string | undefined {
  return process.env.DASHBOARD_AUTH_TOKEN || undefined;
}

/** Called only where whisper-cli is about to run — GENERATE_CAPTIONS always needs this regardless of transcript source. */
export function requireWhisperModel(): string {
  if (!existsSync(config.whisperModelPath)) {
    throw new Error(
      `No Whisper GGML model found at ${config.whisperModelPath}. Download one (e.g. from https://huggingface.co/ggerganov/whisper.cpp) and place it there, or set WHISPER_MODEL to its path.`,
    );
  }
  return config.whisperModelPath;
}
