import { activeAiProvider, config, requireAiModel, requireDeepSeekApiKey, requireNvidiaApiKey } from "../config";
import type { ClipCandidate, RunOptions, TokenUsage, Transcript } from "../pipeline/types";

/** contentType is a free-form label from the create-run form (e.g. "Educational", "Comedy") — passed through as a style hint, not validated against a fixed list. */
function buildSystemPrompt(minDurationSec: number, maxDurationSec: number, contentType?: string): string {
  const typeHint =
    contentType && contentType.toLowerCase() !== "general" ? ` Favor moments that fit a "${contentType}" content style.` : "";
  return `You are a viral content strategist. Given a video transcript with timestamps, identify the strongest short-form clip candidates (${minDurationSec}-${maxDurationSec} seconds each) for TikTok/Shorts/Reels.${typeHint}

Respond with ONLY a JSON array (no markdown fences, no commentary), where each item has exactly these fields:
- "title": string, punchy clip title
- "hookLine": string, the opening line that hooks viewers
- "start": number, start time in seconds
- "end": number, end time in seconds
- "reason": string, why this moment works
- "viralScore": number, 0-100
- "tags": string[], short topical tags`;
}

interface RawCandidate {
  title: unknown;
  hookLine: unknown;
  start: unknown;
  end: unknown;
  reason: unknown;
  viralScore: unknown;
  tags: unknown;
}

function friendlyParseError(detail: string): Error {
  return new Error(
    `AI response could not be used to identify clips: ${detail}. This uses your own BYOK API key — check that it's valid and has quota, then retry.`,
  );
}

/** Strips an optional ```json ... ``` fence some models wrap responses in, despite instructions not to. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function isRawCandidateShapeValid(c: unknown): c is RawCandidate {
  if (typeof c !== "object" || c === null) return false;
  const r = c as Record<string, unknown>;
  return (
    typeof r.title === "string" &&
    typeof r.hookLine === "string" &&
    typeof r.start === "number" &&
    typeof r.end === "number" &&
    typeof r.reason === "string" &&
    typeof r.viralScore === "number" &&
    Array.isArray(r.tags) &&
    r.tags.every((t) => typeof t === "string")
  );
}

/** Parses + validates the raw model response text into candidates, throwing a friendly error on malformed JSON/shape. */
export function parseClipCandidates(responseText: string): RawCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(responseText));
  } catch {
    throw friendlyParseError("response was not valid JSON");
  }
  if (!Array.isArray(parsed)) throw friendlyParseError("response was not a JSON array");
  if (!parsed.every(isRawCandidateShapeValid)) {
    throw friendlyParseError("one or more candidates were missing required fields or had the wrong type");
  }
  return parsed as RawCandidate[];
}

/**
 * Filters to within video bounds, then clamps each candidate into the requested duration window
 * (defaults to config's 15-120s) instead of dropping it — the LLM's start/end is a rough guess and
 * rarely lands exactly inside a narrow user-picked band (e.g. "60-90 sec"), so an exact-match filter
 * was discarding most candidates. Sorts by viralScore descending.
 */
export function filterAndSortCandidates(
  raw: RawCandidate[],
  durationSec: number,
  bounds: { minDurationSec?: number; maxDurationSec?: number } = {},
): ClipCandidate[] {
  const minDurationSec = bounds.minDurationSec ?? config.minClipDurationSec;
  const maxDurationSec = bounds.maxDurationSec ?? config.maxClipDurationSec;
  const candidates: ClipCandidate[] = raw
    .map((c) => {
      const startSec = Math.max(0, c.start as number);
      let endSec = Math.min(durationSec, c.end as number);
      if (endSec - startSec > maxDurationSec) endSec = startSec + maxDurationSec;
      if (endSec - startSec < minDurationSec) endSec = Math.min(durationSec, startSec + minDurationSec);
      return {
        id: crypto.randomUUID(),
        title: c.title as string,
        hookLine: c.hookLine as string,
        startSec,
        endSec,
        reason: c.reason as string,
        viralScore: c.viralScore as number,
        tags: c.tags as string[],
      };
    })
    .filter((c) => c.startSec < c.endSec && c.endSec - c.startSec >= minDurationSec);

  return candidates.sort((a, b) => b.viralScore - a.viralScore);
}

function transcriptToPrompt(transcript: Transcript): string {
  return transcript.segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join("\n");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CallDeepSeekOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  systemPrompt?: string;
}

export interface DeepSeekResult {
  content: string;
  usage: TokenUsage | null;
}

interface ProviderConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  label: string;
  envVarName: string;
}

function friendlyAuthError(cfg: Pick<ProviderConfig, "label" | "envVarName">, status: number): Error {
  return new Error(
    `${cfg.label} response could not be used to identify clips: authentication failed (HTTP ${status}) — check ${cfg.envVarName}. This uses your own ${cfg.envVarName} (BYOK) — check that the key is valid and has quota, then retry.`,
  );
}

/** Shared OpenAI-compatible chat-completions caller (DeepSeek and NVIDIA NIM both speak this shape) with exponential backoff on transport/5xx errors. Auth (401/403) fails fast. */
async function callChatCompletion(
  cfg: ProviderConfig,
  prompt: string,
  opts: Required<Pick<CallDeepSeekOptions, "maxRetries" | "baseDelayMs" | "fetchImpl">> & { systemPrompt: string },
): Promise<DeepSeekResult> {
  const { maxRetries, baseDelayMs, fetchImpl, systemPrompt } = opts;

  let lastError: Error = new Error(`call${cfg.label}: no attempt was made`);
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchImpl(cfg.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (response.status === 401 || response.status === 403) {
        throw friendlyAuthError(cfg, response.status);
      }
      if (!response.ok) {
        throw new Error(`${cfg.label} API returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      const content = data.choices[0]?.message.content;
      if (!content) throw friendlyParseError("response had no message content");
      const usage = data.usage
        ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens, totalTokens: data.usage.total_tokens }
        : null;
      return { content, usage };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isAuthError = lastError.message.includes("authentication failed");
      if (isAuthError || attempt === maxRetries) throw lastError;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

/** Calls DeepSeek chat completions (BYOK via DEEPSEEK_API_KEY). */
export async function callDeepSeek(prompt: string, opts: CallDeepSeekOptions = {}): Promise<DeepSeekResult> {
  const {
    maxRetries = 3,
    baseDelayMs = 500,
    fetchImpl = fetch,
    systemPrompt = buildSystemPrompt(config.minClipDurationSec, config.maxClipDurationSec),
  } = opts;
  const cfg: ProviderConfig = {
    apiUrl: config.deepseekApiUrl,
    apiKey: requireDeepSeekApiKey(),
    model: requireAiModel("deepseek"),
    label: "DeepSeek",
    envVarName: "DEEPSEEK_API_KEY",
  };
  return callChatCompletion(cfg, prompt, { maxRetries, baseDelayMs, fetchImpl, systemPrompt });
}

/** Calls NVIDIA's OpenAI-compatible NIM chat completions (BYOK via NVIDIA_API_KEY). */
export async function callNvidia(prompt: string, opts: CallDeepSeekOptions = {}): Promise<DeepSeekResult> {
  const {
    maxRetries = 3,
    baseDelayMs = 500,
    fetchImpl = fetch,
    systemPrompt = buildSystemPrompt(config.minClipDurationSec, config.maxClipDurationSec),
  } = opts;
  const cfg: ProviderConfig = {
    apiUrl: config.nvidiaApiUrl,
    apiKey: requireNvidiaApiKey(),
    model: requireAiModel("nvidia"),
    label: "NVIDIA",
    envVarName: "NVIDIA_API_KEY",
  };
  return callChatCompletion(cfg, prompt, { maxRetries, baseDelayMs, fetchImpl, systemPrompt });
}

/** Model IDs a provider exposes for the user's key, from its OpenAI-compatible /models endpoint — backs the Settings model dropdown (a hardcoded list goes stale as providers ship/retire models). Throws the same BYOK-friendly errors as callChatCompletion. */
export async function listAiModels(
  provider: "deepseek" | "nvidia",
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<string[]> {
  const { fetchImpl = fetch } = opts;
  const cfg =
    provider === "deepseek"
      ? { url: config.deepseekModelsUrl, apiKey: requireDeepSeekApiKey(), label: "DeepSeek", envVarName: "DEEPSEEK_API_KEY" }
      : { url: config.nvidiaModelsUrl, apiKey: requireNvidiaApiKey(), label: "NVIDIA", envVarName: "NVIDIA_API_KEY" };

  const response = await fetchImpl(cfg.url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
  if (response.status === 401 || response.status === 403) throw friendlyAuthError(cfg, response.status);
  if (!response.ok) throw new Error(`${cfg.label} models API returned HTTP ${response.status}`);

  const data = (await response.json()) as { data?: Array<{ id?: string }> };
  return (data.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
}

export interface IdentifyClipsResult {
  clips: ClipCandidate[];
  tokenUsage: TokenUsage | null;
}export async function identifyClips(
  transcript: Transcript,
  durationSec: number,
  options: RunOptions = {},
  opts: CallDeepSeekOptions = {},
): Promise<IdentifyClipsResult> {
  const minDurationSec = options.minDurationSec ?? config.minClipDurationSec;
  const maxDurationSec = options.maxDurationSec ?? config.maxClipDurationSec;
  const systemPrompt = buildSystemPrompt(minDurationSec, maxDurationSec, options.contentType);

  const call = (options.aiProvider ?? activeAiProvider()) === "nvidia" ? callNvidia : callDeepSeek;
  const { content, usage } = await call(transcriptToPrompt(transcript), { ...opts, systemPrompt });
  const raw = parseClipCandidates(content);
  let clips = filterAndSortCandidates(raw, durationSec, { minDurationSec, maxDurationSec });
  if (options.clipCount) clips = clips.slice(0, options.clipCount);
  return { clips, tokenUsage: usage };
}
