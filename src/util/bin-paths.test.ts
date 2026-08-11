import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config } from "../config";
import { resolveBinary } from "./bin-paths";

let testBinDir: string;
let originalBinDir: string;
const originalPlatform = process.platform;

function setPlatform(value: string) {
  Object.defineProperty(process, "platform", { value });
}

beforeEach(() => {
  originalBinDir = config.binDir;
  testBinDir = mkdtempSync(join(tmpdir(), "reel-farmer-bin-test-"));
  config.binDir = testBinDir;
});

afterEach(() => {
  config.binDir = originalBinDir;
  setPlatform(originalPlatform);
  rmSync(testBinDir, { recursive: true, force: true });
});

describe("resolveBinary", () => {
  test("returns the downloaded copy when it exists in binDir", () => {
    writeFileSync(join(testBinDir, "yt-dlp"), "#!/bin/sh\n");
    expect(resolveBinary("yt-dlp")).toBe(join(testBinDir, "yt-dlp"));
  });

  test("falls back to the bare name (PATH) when nothing was downloaded", () => {
    expect(resolveBinary("ffmpeg")).toBe("ffmpeg");
  });

  test("looks for a .exe suffix on windows", () => {
    setPlatform("win32");
    writeFileSync(join(testBinDir, "yt-dlp.exe"), "");
    expect(resolveBinary("yt-dlp")).toBe(join(testBinDir, "yt-dlp.exe"));
  });

  test("finds the executable nested inside a package directory (archive-based installs)", () => {
    mkdirSync(join(testBinDir, "whisper-cli", "Release"), { recursive: true });
    writeFileSync(join(testBinDir, "whisper-cli", "libwhisper.so"), "");
    writeFileSync(join(testBinDir, "whisper-cli", "Release", "whisper-cli"), "");
    expect(resolveBinary("whisper-cli")).toBe(join(testBinDir, "whisper-cli", "Release", "whisper-cli"));
  });
});
