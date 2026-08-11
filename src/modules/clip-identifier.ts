import { config, requireDeepSeekApiKey } from "../config";
import type { ClipCandidate, TokenUsage, Transcript } from "../pipeline/types";

const SYSTEM_PROMPT = `You are a viral content strategist. Given a video transcript with timestamps, identify the strongest short-form clip candidates (15-120 seconds each) for TikTok/Shorts/Reels.

Respond with ONLY a JSON array (no markdown fences, no commentary), where each item has exactly these fields:
- "title": string, punchy clip title
- "hookLine": string, the opening line that hooks viewers
- "start": number, start time in seconds
- "end": number, end time in seconds
- "reason": string, why this moment works
- "viralScore": number, 0-100
- "tags": string[], short topical tags`;

interface RawCandidate {
  title: unknown;
  hookLine: unknown;
  start: unknown;
  end: unknown;
  reason: unknown;
  viralScore: unknown;
  tags: unknown;
}

function friendlyDeepSeekError(detail: string): Error {
  return new Error(
    `DeepSeek response could not be used to identify clips: ${detail}. This uses your own DEEPSEEK_API_KEY (BYOK) — check that the key is valid and has quota, then retry.`,
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
    throw friendlyDeepSeekError("response was not valid JSON");
  }
  if (!Array.isArray(parsed)) throw friendlyDeepSeekError("response was not a JSON array");
  if (!parsed.every(isRawCandidateShapeValid)) {
    throw friendlyDeepSeekError("one or more candidates were missing required fields or had the wrong type");
  }
  return parsed as RawCandidate[];
}

/** Filters to the 15-120s window + within video bounds, then sorts by viralScore descending. */
export function filterAndSortCandidates(raw: RawCandidate[], durationSec: number): ClipCandidate[] {
  const candidates: ClipCandidate[] = raw
    .map((c) => ({
      id: crypto.randomUUID(),
      title: c.title as string,
      hookLine: c.hookLine as string,
      startSec: c.start as number,
      endSec: c.end as number,
      reason: c.reason as string,
      viralScore: c.viralScore as number,
      tags: c.tags as string[],
    }))
    .filter((c) => {
      const duration = c.endSec - c.startSec;
      return (
        c.startSec >= 0 &&
        c.endSec <= durationSec &&
        c.startSec < c.endSec &&
        duration >= config.minClipDurationSec &&
        duration <= config.maxClipDurationSec
      );
    });

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
}

export interface DeepSeekResult {
  content: string;
  usage: TokenUsage | null;
}

/** Calls DeepSeek chat completions with exponential backoff on transport/5xx errors. Auth (401/403) fails fast. */
export async function callDeepSeek(prompt: string, opts: CallDeepSeekOptions = {}): Promise<DeepSeekResult> {
  const { maxRetries = 3, baseDelayMs = 500, fetchImpl = fetch } = opts;
  const apiKey = requireDeepSeekApiKey();

  let lastError: Error = new Error("callDeepSeek: no attempt was made");
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchImpl(config.deepseekApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (response.status === 401 || response.status === 403) {
        throw friendlyDeepSeekError(`authentication failed (HTTP ${response.status}) — check DEEPSEEK_API_KEY`);
      }
      if (!response.ok) {
        throw new Error(`DeepSeek API returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      const content = data.choices[0]?.message.content;
      if (!content) throw friendlyDeepSeekError("response had no message content");
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

export interface IdentifyClipsResult {
  clips: ClipCandidate[];
  tokenUsage: TokenUsage | null;
}

export async function identifyClips(
  transcript: Transcript,
  durationSec: number,
  opts: CallDeepSeekOptions = {},
): Promise<IdentifyClipsResult> {
  const { content, usage } = await callDeepSeek(transcriptToPrompt(transcript), opts);
  const raw = parseClipCandidates(content);
  return { clips: filterAndSortCandidates(raw, durationSec), tokenUsage: usage };
}
