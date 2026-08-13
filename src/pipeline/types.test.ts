import { describe, expect, test } from "bun:test";
import { isTooCloseToChromaKey } from "./types";

describe("isTooCloseToChromaKey", () => {
  test("flags the chroma key itself and near-identical saturated greens", () => {
    expect(isTooCloseToChromaKey("#00ff00")).toBe(true);
    expect(isTooCloseToChromaKey("#1aff1a")).toBe(true);
  });

  test("allows colors that used to be borderline under the old, more aggressive similarity — the fix was lowering composer.ts's colorkey similarity, not banning these shades", () => {
    expect(isTooCloseToChromaKey("#33cc33")).toBe(false);
    expect(isTooCloseToChromaKey("#0b1c30")).toBe(false);
  });

  test("allows colors far from green, including the current preset swatches", () => {
    expect(isTooCloseToChromaKey("#ffffff")).toBe(false);
    expect(isTooCloseToChromaKey("#ffafd3")).toBe(false);
    expect(isTooCloseToChromaKey("#c0c1ff")).toBe(false);
    expect(isTooCloseToChromaKey("#1a237e")).toBe(false);
    expect(isTooCloseToChromaKey("#FFD700")).toBe(false);
  });
});
