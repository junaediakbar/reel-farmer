import { describe, expect, test } from "bun:test";
import type { CaptionGroup } from "../pipeline/types";
import { applyWordResize } from "./CaptionEditor";

function group(words: Array<[string, number, number]>): CaptionGroup {
  const w = words.map(([word, start, end]) => ({ word, start, end }));
  return { words: w, start: w[0]!.start, end: w[w.length - 1]!.end };
}

describe("applyWordResize", () => {
  test("extends the target word's end by deltaSec", () => {
    const groups = [group([["hi", 0, 1]])];
    const result = applyWordResize(groups, 0, 0, 0.5);
    expect(result[0]!.words[0]!.end).toBe(1.5);
  });

  test("syncs the group's end to the last word's end", () => {
    const groups = [group([["a", 0, 1], ["b", 1, 2]])];
    const result = applyWordResize(groups, 0, 1, 0.5);
    expect(result[0]!.end).toBe(2.5);
  });

  test("clamps to a 0.05s minimum duration on large negative delta", () => {
    const groups = [group([["a", 0, 1]])];
    const result = applyWordResize(groups, 0, 0, -10);
    expect(result[0]!.words[0]!.end).toBe(0.05);
  });

  test("leaves other groups untouched", () => {
    const groups = [group([["a", 0, 1]]), group([["b", 5, 6]])];
    const result = applyWordResize(groups, 0, 0, 1);
    expect(result[1]).toEqual(groups[1]!);
  });
});
