import { describe, expect, test } from "bun:test";
import { parseSilenceDetectOutput } from "./silence-remover";

describe("parseSilenceDetectOutput", () => {
  test("parses paired silence_start/silence_end lines into intervals", () => {
    const stderr = `
[silencedetect @ 0x7f9] silence_start: 12.34
[silencedetect @ 0x7f9] silence_end: 15.67 | silence_duration: 3.33
[silencedetect @ 0x7f9] silence_start: 40.1
[silencedetect @ 0x7f9] silence_end: 41.9 | silence_duration: 1.8
`;
    const intervals = parseSilenceDetectOutput(stderr);
    expect(intervals).toEqual([
      { start: 12.34, end: 15.67 },
      { start: 40.1, end: 41.9 },
    ]);
  });

  test("returns an empty list when there is no silence", () => {
    expect(parseSilenceDetectOutput("frame= 100 fps=30\n")).toEqual([]);
  });

  test("ignores an unmatched trailing silence_start (stream ended mid-silence)", () => {
    const stderr = `
[silencedetect @ 0x7f9] silence_start: 12.34
[silencedetect @ 0x7f9] silence_end: 15.67 | silence_duration: 3.33
[silencedetect @ 0x7f9] silence_start: 99.0
`;
    expect(parseSilenceDetectOutput(stderr)).toEqual([{ start: 12.34, end: 15.67 }]);
  });
});
