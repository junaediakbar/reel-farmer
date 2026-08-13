import { beforeEach, describe, expect, test } from "bun:test";
import { callDeepSeek, callNvidia, filterAndSortCandidates, listAiModels, parseClipCandidates } from "./clip-identifier";

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.NVIDIA_API_KEY = "test-key";
  process.env.DEEPSEEK_MODEL = "deepseek-chat";
  process.env.NVIDIA_MODEL = "deepseek-ai/deepseek-v3.1";
});

describe("parseClipCandidates", () => {
  const valid = JSON.stringify([
    { title: "Hook", hookLine: "Wait for it", start: 0, end: 20, reason: "funny", viralScore: 80, tags: ["funny"] },
  ]);

  test("parses a valid JSON array", () => {
    expect(parseClipCandidates(valid)).toHaveLength(1);
  });

  test("strips a markdown code fence some models add anyway", () => {
    expect(parseClipCandidates("```json\n" + valid + "\n```")).toHaveLength(1);
  });

  test("throws a friendly error on invalid JSON", () => {
    expect(() => parseClipCandidates("not json")).toThrow(/BYOK/);
  });

  test("throws a friendly error when candidates are missing required fields", () => {
    expect(() => parseClipCandidates(JSON.stringify([{ title: "Only a title" }]))).toThrow(/BYOK/);
  });

  test("throws when the response is not an array", () => {
    expect(() => parseClipCandidates(JSON.stringify({ title: "not an array" }))).toThrow(/BYOK/);
  });
});

describe("filterAndSortCandidates", () => {
  function raw(start: number, end: number, viralScore: number) {
    return { title: "t", hookLine: "h", start, end, reason: "r", viralScore, tags: [] };
  }

  test("clamps candidates into the duration window instead of dropping them", () => {
    const candidates = filterAndSortCandidates(
      [
        raw(0, 10, 50), // too short (10s) -> extended to the 15s minimum
        raw(0, 30, 90), // already within bounds -> unchanged
        raw(0, 300, 99), // too long (300s) -> trimmed to the 120s maximum
      ],
      300,
    );
    expect(candidates).toHaveLength(3);
    const byScore = new Map(candidates.map((c) => [c.viralScore, c]));
    expect(byScore.get(50)).toMatchObject({ startSec: 0, endSec: 15 });
    expect(byScore.get(90)).toMatchObject({ startSec: 0, endSec: 30 });
    expect(byScore.get(99)).toMatchObject({ startSec: 0, endSec: 120 });
  });

  test("drops a candidate only when it can't reach the minimum duration within video bounds", () => {
    const candidates = filterAndSortCandidates([raw(90, 130, 70)], 100);
    expect(candidates).toHaveLength(0);
  });

  test("sorts by viralScore descending", () => {
    const candidates = filterAndSortCandidates([raw(0, 20, 40), raw(20, 40, 95), raw(40, 60, 70)], 100);
    expect(candidates.map((c) => c.viralScore)).toEqual([95, 70, 40]);
  });
});

describe("callDeepSeek", () => {
  function fakeResponse(content: string, status = 200) {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
      { status },
    );
  }

  test("returns content on first success", async () => {
    const fetchImpl = (async () => fakeResponse("hello")) as unknown as typeof fetch;
    const result = await callDeepSeek("prompt", { fetchImpl });
    expect(result.content).toBe("hello");
    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 20, totalTokens: 120 });
  });

  test("retries with backoff on transport failure, then succeeds", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls < 3) throw new Error("network blip");
      return fakeResponse("recovered");
    }) as unknown as typeof fetch;

    const result = await callDeepSeek("prompt", { fetchImpl, maxRetries: 3, baseDelayMs: 1 });
    expect(result.content).toBe("recovered");
    expect(calls).toBe(3);
  });

  test("does not retry on an auth error", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return fakeResponse("", 401);
    }) as unknown as typeof fetch;

    await expect(callDeepSeek("prompt", { fetchImpl, maxRetries: 3, baseDelayMs: 1 })).rejects.toThrow(/BYOK/);
    expect(calls).toBe(1);
  });

  test("gives up after maxRetries transport failures", async () => {
    const fetchImpl = (async () => {
      throw new Error("still down");
    }) as unknown as typeof fetch;

    await expect(callDeepSeek("prompt", { fetchImpl, maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow(/still down/);
  });
});

describe("callNvidia", () => {
  function fakeResponse(content: string, status = 200) {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
      { status },
    );
  }

  test("returns content on first success", async () => {
    const fetchImpl = (async () => fakeResponse("hello")) as unknown as typeof fetch;
    const result = await callNvidia("prompt", { fetchImpl });
    expect(result.content).toBe("hello");
    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 20, totalTokens: 120 });
  });

  test("does not retry on an auth error, and the message names NVIDIA_API_KEY", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return fakeResponse("", 401);
    }) as unknown as typeof fetch;

    await expect(callNvidia("prompt", { fetchImpl, maxRetries: 3, baseDelayMs: 1 })).rejects.toThrow(/NVIDIA_API_KEY/);
    expect(calls).toBe(1);
  });
});

describe("listAiModels", () => {
  function modelsResponse(ids: string[], status = 200) {
    return new Response(JSON.stringify({ object: "list", data: ids.map((id) => ({ id })) }), { status });
  }

  test("returns the model IDs the provider exposes via /models", async () => {
    const fetchImpl = (async () => modelsResponse(["deepseek-chat", "deepseek-reasoner"])) as unknown as typeof fetch;
    expect(await listAiModels("deepseek", { fetchImpl })).toEqual(["deepseek-chat", "deepseek-reasoner"]);
  });

  test("throws a friendly BYOK error on an auth failure", async () => {
    const fetchImpl = (async () => modelsResponse([], 401)) as unknown as typeof fetch;
    await expect(listAiModels("deepseek", { fetchImpl })).rejects.toThrow(/BYOK/);
  });
});
