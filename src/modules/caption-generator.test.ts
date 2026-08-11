import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { WordTimestamp } from "../pipeline/types";
import { alignToReference, groupWords } from "./caption-generator";

function words(...pairs: Array<[string, number, number]>): WordTimestamp[] {
  return pairs.map(([word, start, end]) => ({ word, start, end }));
}

describe("alignToReference", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("swaps in the reference transcript's text when word counts match", () => {
    const whisper = words(["helo", 0, 0.5], ["wrld", 0.5, 1]);
    const aligned = alignToReference(whisper, "hello world");
    expect(aligned.map((w) => w.word)).toEqual(["hello", "world"]);
    // timestamps stay Whisper's — reference has none
    expect(aligned[0]!.start).toBe(0);
    expect(aligned[1]!.end).toBe(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("falls back to Whisper's own words when counts drift (no fuzzy matching)", () => {
    const whisper = words(["um", 0, 0.2], ["hello", 0.2, 0.6], ["world", 0.6, 1]);
    // reference is missing the filler "um" -> count mismatch -> positional mapping would misalign
    const aligned = alignToReference(whisper, "hello world");
    expect(aligned).toEqual(whisper);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("G10: logs a structured warning with runId/clipId and word counts on fallback", () => {
    const whisper = words(["um", 0, 0.2], ["hello", 0.2, 0.6]);
    alignToReference(whisper, "hello world extra", { runId: "run-1", clipId: "clip-1" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({
      level: "warn",
      runId: "run-1",
      clipId: "clip-1",
      whisperWordCount: 2,
      referenceWordCount: 3,
    });
  });
});

describe("groupWords", () => {
  test("groups into chunks of the given size, using the first/last word's timestamps", () => {
    const w = words(["a", 0, 1], ["b", 1, 2], ["c", 2, 3], ["d", 3, 4], ["e", 4, 5], ["f", 5, 6], ["g", 6, 7]);
    const groups = groupWords(w, 6);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.words).toHaveLength(6);
    expect(groups[0]!.start).toBe(0);
    expect(groups[0]!.end).toBe(6);
    expect(groups[1]!.words).toHaveLength(1);
    expect(groups[1]!.start).toBe(6);
    expect(groups[1]!.end).toBe(7);
  });

  test("returns an empty list for no words", () => {
    expect(groupWords([], 6)).toEqual([]);
  });
});
