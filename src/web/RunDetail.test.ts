import { describe, expect, test } from "bun:test";
import { parseImportedClips } from "./RunDetail";

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
