import { describe, expect, test } from "bun:test";
import { parseImportedClips, undoableReducer } from "./RunDetail";

describe("parseImportedClips", () => {
  test("wraps a single object into a one-item list with defaults filled in", () => {
    const [clip] = parseImportedClips(JSON.stringify({ startSec: 1, endSec: 10 }));
    expect(clip).toMatchObject({
      title: "Imported clip",
      hookLine: "",
      startSec: 1,
      endSec: 10,
      reason: "imported",
      viralScore: 0,
      tags: [],
      selected: true,
    });
    expect(clip!.id).toBeTruthy();
  });

  test("parses an array and preserves provided fields", () => {
    const clips = parseImportedClips(
      JSON.stringify([
        { id: "c1", title: "My clip", startSec: 0, endSec: 5, viralScore: 90, tags: ["a"] },
        { startSec: 10, endSec: 20 },
      ]),
    );
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ id: "c1", title: "My clip", viralScore: 90, tags: ["a"] });
  });

  test("throws when startSec is missing or non-numeric", () => {
    expect(() => parseImportedClips(JSON.stringify({ endSec: 10 }))).toThrow(/startSec\/endSec/);
    expect(() => parseImportedClips(JSON.stringify({ startSec: "0", endSec: 10 }))).toThrow(/startSec\/endSec/);
  });

  test("throws when endSec is missing", () => {
    expect(() => parseImportedClips(JSON.stringify({ startSec: 0 }))).toThrow(/startSec\/endSec/);
  });

  test("throws on invalid JSON", () => {
    expect(() => parseImportedClips("not json")).toThrow();
  });
});

describe("undoableReducer", () => {
  const initial = { present: "a", past: [] as string[], future: [] as string[] };

  test("set pushes the previous value onto past and clears future", () => {
    const s1 = undoableReducer(initial, { type: "set", updater: "b" });
    expect(s1).toEqual({ present: "b", past: ["a"], future: [] });
    const s2 = undoableReducer(s1, { type: "set", updater: "c" });
    expect(s2).toEqual({ present: "c", past: ["a", "b"], future: [] });
  });

  test("set is a no-op (same reference) when the result equals present", () => {
    const s1 = undoableReducer(initial, { type: "set", updater: "a" });
    expect(s1).toBe(initial);
  });

  test("a function updater resolves against the reducer's own state.present, not a stale closure", () => {
    // This is the shape refresh()'s setInterval callback uses (captured once at mount): passing a
    // function lets the reducer always read the *current* present, the same guarantee React's own
    // setState(updater) gives — a hand-rolled `set` that resolves the updater itself, outside the
    // reducer, against a closed-over `present` would silently revert later edits every poll tick.
    const s1 = undoableReducer(initial, { type: "set", updater: "b" });
    const s2 = undoableReducer(s1, { type: "set", updater: (prev: string) => prev + prev });
    expect(s2).toEqual({ present: "bb", past: ["a", "b"], future: [] });
  });

  test("undo then redo round-trips back to the same state", () => {
    const s1 = undoableReducer(initial, { type: "set", updater: "b" });
    const s2 = undoableReducer(s1, { type: "set", updater: "c" });
    const undone = undoableReducer(s2, { type: "undo" });
    expect(undone).toEqual({ present: "b", past: ["a"], future: ["c"] });
    const redone = undoableReducer(undone, { type: "redo" });
    expect(redone).toEqual(s2);
  });

  test("undo/redo are no-ops at the ends of history", () => {
    expect(undoableReducer(initial, { type: "undo" })).toBe(initial);
    expect(undoableReducer(initial, { type: "redo" })).toBe(initial);
  });

  test("a new set after undo drops the abandoned future (standard undo/redo branching)", () => {
    const s1 = undoableReducer(initial, { type: "set", updater: "b" });
    const s2 = undoableReducer(s1, { type: "set", updater: "c" });
    const undone = undoableReducer(s2, { type: "undo" }); // present: "b", future: ["c"]
    const branched = undoableReducer(undone, { type: "set", updater: "d" });
    expect(branched).toEqual({ present: "d", past: ["a", "b"], future: [] });
  });
});
