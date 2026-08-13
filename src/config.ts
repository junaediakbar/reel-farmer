import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  licenseCachePath: resolve(appDataDir(), "license.json"),
  settingsPath: resolve(appDataDir(), "settings.json"),

  deepseekApiUrl: process.env.DEEPSEEK_API_URL ?? "https://api.deepseek.com/chat/completions",
  nvidiaApiUrl: process.env.NVIDIA_API_URL ?? "https://integrate.api.nvidia.com/v1/chat/completions",
  // OpenAI-compatible /models endpoints — used to populate the Settings model dropdown from what the
  // provider actually exposes for the user's key, instead of a hardcoded list that goes stale.
  deepseekModelsUrl: process.env.DEEPSEEK_MODELS_URL ?? "https://api.deepseek.com/models",
  nvidiaModelsUrl: process.env.NVIDIA_MODELS_URL ?? "https://integrate.api.nvidia.com/v1/models",

  maxParallelClips: num(process.env.MAX_PARALLEL_CLIPS, 3),
  clipSpeed: num(process.env.CLIP_SPEED, 1.2),
  silenceThresholdDb: num(process.env.SILENCE_THRESHOLD_DB, -30),
  silenceMinDuration: num(process.env.SILENCE_MIN_DURATION, 0.5),
  // Multilingual model + auto language detection — an English-only (.en) model hallucinates
  // "(speaking in foreign language)" placeholders instead of transcribing non-English audio,
  // which starved clip identification and captions down to whatever few English lines existed.
  whisperModelPath: process.env.WHISPER_MODEL ?? resolve(process.cwd(), "models", "ggml-base.bin"),
  whisperLanguage: process.env.WHISPER_LANGUAGE ?? "auto",
  captionAnimate: bool(process.env.CAPTION_ANIMATE, true),
  captionOffsetMs: num(process.env.CAPTION_OFFSET_MS, 0),
  webPort: num(process.env.WEB_PORT, 3001),
  preferYouTubeTranscripts: bool(process.env.PREFER_YOUTUBE_TRANSCRIPTS, true),

  minClipDurationSec: 15,
  maxClipDurationSec: 120,
  captionWordsPerGroup: 6,
};

/** Days a cached license stays valid without reaching the license server (offline tolerance). */
export const LICENSE_GRACE_PERIOD_DAYS = 7;

/**
 * Called only where a DeepSeek call is about to happen — not at startup, so read-only commands
 * (status/clean) work without a key. Reads process.env live (not the config snapshot) so tests
 * can set DEEPSEEK_API_KEY per-test regardless of when config.ts was first imported.
 */
export function requireDeepSeekApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY || readPersistedSettings().deepseekApiKey;
  if (!key) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. Add it in Settings, or in your .env, before running a pipeline that identifies clips (BYOK — this is your own DeepSeek key, not provided by Reel Farmer).",
    );
  }
  return key;
}

/** Same as requireDeepSeekApiKey() but for the NVIDIA (NIM) provider — called only when a run picks aiProvider: "nvidia". */
export function requireNvidiaApiKey(): string {
  const key = process.env.NVIDIA_API_KEY || readPersistedSettings().nvidiaApiKey;
  if (!key) {
    throw new Error(
      "NVIDIA_API_KEY is not set. Add it in Settings, or in your .env, before running a pipeline that identifies clips with the NVIDIA provider (BYOK — this is your own NVIDIA API key, not provided by Reel Farmer).",
    );
  }
  return key;
}

export type AiProvider = "deepseek" | "nvidia";

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  deepseek: "DeepSeek",
  nvidia: "NVIDIA",
};

interface PersistedSettings {
  deepseekApiKey?: string;
  nvidiaApiKey?: string;
  activeAiProvider?: AiProvider;
  deepseekModel?: string;
  nvidiaModel?: string;
  deepseekModelHistory?: string[];
  nvidiaModelHistory?: string[];
}

/** Cap for the per-provider "recently used" model list in the Settings dropdown. */
const MODEL_HISTORY_LIMIT = 10;

/** Most-recent-first, deduped append. */
function addToHistory(history: string[] | undefined, model: string): string[] {
  return [model, ...(history ?? []).filter((m) => m !== model)].slice(0, MODEL_HISTORY_LIMIT);
}

function readPersistedSettings(): PersistedSettings {
  if (!existsSync(config.settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(config.settingsPath, "utf8")) as PersistedSettings;
  } catch {
    return {};
  }
}

/** Shared by every settings.json writer — creates the app data dir on first write (nothing else ever does, so a fresh install 500s on the first Save without this). */
function writePersistedSettings(patch: Partial<PersistedSettings>): void {
  mkdirSync(dirname(config.settingsPath), { recursive: true });
  writeFileSync(config.settingsPath, JSON.stringify({ ...readPersistedSettings(), ...patch }));
}

/** Persists the user's own DeepSeek key (BYOK) to disk so it survives restarts without living in .env. */
export function saveDeepSeekApiKey(key: string): void {
  writePersistedSettings({ deepseekApiKey: key });
}

/** Masked status for the Settings UI — never returns the key itself. */
export function deepSeekApiKeyStatus(): { set: boolean; preview: string | null } {
  const key = process.env.DEEPSEEK_API_KEY || readPersistedSettings().deepseekApiKey;
  return key ? { set: true, preview: `••••${key.slice(-4)}` } : { set: false, preview: null };
}

/** Persists the user's own NVIDIA key (BYOK) to disk so it survives restarts without living in .env. */
export function saveNvidiaApiKey(key: string): void {
  writePersistedSettings({ nvidiaApiKey: key });
}

/** Masked status for the Settings UI — never returns the key itself. */
export function nvidiaApiKeyStatus(): { set: boolean; preview: string | null } {
  const key = process.env.NVIDIA_API_KEY || readPersistedSettings().nvidiaApiKey;
  return key ? { set: true, preview: `••••${key.slice(-4)}` } : { set: false, preview: null };
}

/** Which BYOK provider IDENTIFY_CLIPS uses — a single global choice (Settings UI), not per-run. Defaults to DeepSeek. */
export function activeAiProvider(): AiProvider {
  return readPersistedSettings().activeAiProvider ?? "deepseek";
}

/** Persists the chosen AI provider so new runs use it without needing an env var. */
export function setActiveAiProvider(provider: AiProvider): void {
  writePersistedSettings({ activeAiProvider: provider });
}

/**
 * The analysis model for a provider — the model ID actually sent to the API for IDENTIFY_CLIPS.
 * A provider's model is always chosen explicitly: `requireAiModel` throws (pointing to Settings)
 * until the user picks one, rather than silently defaulting to a model they didn't opt into.
 * Reads process.env live (DEEPSEEK_MODEL/NVIDIA_MODEL) so tests and .env-driven installs work
 * without ever touching settings.json.
 */
export function requireAiModel(provider: AiProvider): string {
  const envVar = provider === "deepseek" ? "DEEPSEEK_MODEL" : "NVIDIA_MODEL";
  const model = process.env[envVar] || (provider === "deepseek" ? readPersistedSettings().deepseekModel : readPersistedSettings().nvidiaModel);
  if (!model) {
    throw new Error(
      `No ${AI_PROVIDER_LABELS[provider]} model selected. Open Settings → AI provider and choose a model before identifying clips (or set ${envVar} in your .env).`,
    );
  }
  return model;
}

/** Current model for the Settings UI — never throws, reports whether a model is configured. */
export function aiModelStatus(provider: AiProvider): { set: boolean; model: string | null } {
  const envVar = provider === "deepseek" ? "DEEPSEEK_MODEL" : "NVIDIA_MODEL";
  const model = process.env[envVar] || (provider === "deepseek" ? readPersistedSettings().deepseekModel : readPersistedSettings().nvidiaModel);
  return model ? { set: true, model } : { set: false, model: null };
}

/** Persists the user's chosen analysis model for a provider so it survives restarts, and records it in that provider's recently-used history. */
export function saveAiModel(provider: AiProvider, model: string): void {
  if (provider === "deepseek") {
    const prev = readPersistedSettings();
    writePersistedSettings({ deepseekModel: model, deepseekModelHistory: addToHistory(prev.deepseekModelHistory, model) });
  } else {
    const prev = readPersistedSettings();
    writePersistedSettings({ nvidiaModel: model, nvidiaModelHistory: addToHistory(prev.nvidiaModelHistory, model) });
  }
}

/** Recently-used models for a provider, most recent first — lets the Settings dropdown switch back to a model the user already picked without retyping it. */
export function aiModelHistory(provider: AiProvider): string[] {
  return provider === "deepseek" ? (readPersistedSettings().deepseekModelHistory ?? []) : (readPersistedSettings().nvidiaModelHistory ?? []);
}

/**
 * Optional shared-secret gate for the web dashboard (G2: it otherwise has no auth at all).
 * Unset by default — desktop app is localhost-only, single-user. Reads process.env live so
 * tests can set/unset DASHBOARD_AUTH_TOKEN per-test regardless of when config.ts was first imported.
 */
export function dashboardAuthToken(): string | undefined {
  return process.env.DASHBOARD_AUTH_TOKEN || undefined;
}

/**
 * Optional license backend URL. Unset by default — license checks are a no-op until this is
 * configured (mirrors dashboardAuthToken()'s unset-by-default gate). Reads process.env live so
 * tests can set/unset LICENSE_SERVER_URL per-test regardless of when config.ts was first imported.
 */
export function licenseServerUrl(): string | undefined {
  return process.env.LICENSE_SERVER_URL || undefined;
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
