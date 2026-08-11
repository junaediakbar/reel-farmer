import { beforeEach, describe, expect, test } from "bun:test";
import { callDeepSeek, filterAndSortCandidates, parseClipCandidates } from "./clip-identifier";

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = "test-key";
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

  test("keeps only clips within the 15-120s window and video bounds", () => {
    const candidates = filterAndSortCandidates(
      [
        raw(0, 10, 50), // too short
        raw(0, 30, 90), // ok
        raw(0, 200, 99), // too long
        raw(90, 130, 70), // exceeds duration (100)
      ],
      100,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.viralScore).toBe(90);
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
