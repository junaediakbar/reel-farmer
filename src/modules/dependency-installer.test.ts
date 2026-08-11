import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstallProgress } from "./dependency-installer";

const runCommandCalls: string[][] = [];
let brewExitCode = 0;

mock.module("../util/exec", () => ({
  runCommand: mock(async (cmd: string[]) => {
    runCommandCalls.push(cmd);
    return { stdout: "", stderr: brewExitCode === 0 ? "" : "brew failed", exitCode: cmd[0] === "brew" ? brewExitCode : 0 };
  }),
  runCommandOrThrow: mock(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
}));

const { checkStatus, installDependency } = await import("./dependency-installer");
const { config } = await import("../config");

let testBinDir: string;
let originalBinDir: string;
let originalPath: string | undefined;

beforeEach(() => {
  runCommandCalls.length = 0;
  brewExitCode = 0;
  originalBinDir = config.binDir;
  testBinDir = mkdtempSync(join(tmpdir(), "reel-farmer-deps-test-"));
  config.binDir = testBinDir;
  originalPath = process.env.PATH;
});

afterEach(() => {
  config.binDir = originalBinDir;
  process.env.PATH = originalPath;
  rmSync(testBinDir, { recursive: true, force: true });
});

async function sha256(content: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

function fakeFetch(content: string, opts: { supportsRange?: boolean } = {}) {
  const bytes = new TextEncoder().encode(content);
  return mock(async (_url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    const range = headers?.Range;
    if (range && opts.supportsRange) {
      const start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
      const slice = bytes.slice(start);
      return new Response(slice, { status: 206, headers: { "content-length": String(slice.length) } });
    }
    return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } });
  }) as unknown as typeof fetch;
}

describe("installDependency (download)", () => {
  test("downloads, verifies checksum, and installs the file executable", async () => {
    const content = "yt-dlp fake binary content";
    const destPath = join(testBinDir, "yt-dlp");
    const progress: InstallProgress[] = [];

    await installDependency(
      { id: "yt-dlp", label: "t", sizeEstimateMb: 1, destPath, source: { kind: "download", url: "https://x/y", checksum: { type: "pinned", sha256: await sha256(content) } } },
      (p) => progress.push(p as InstallProgress),
      { fetchImpl: fakeFetch(content) },
    );

    expect(readFileSync(destPath, "utf8")).toBe(content);
    expect(statSync(destPath).mode & 0o111).toBeGreaterThan(0);
    expect(progress.at(-1)?.phase).toBe("done");
  });

  test("resumes from a partial .part file using a Range request", async () => {
    const content = "0123456789ABCDEF";
    const destPath = join(testBinDir, "yt-dlp");
    writeFileSync(`${destPath}.part`, content.slice(0, 6));
    const fetchImpl = fakeFetch(content, { supportsRange: true });

    await installDependency(
      { id: "yt-dlp", label: "t", sizeEstimateMb: 1, destPath, source: { kind: "download", url: "https://x/y", checksum: { type: "pinned", sha256: await sha256(content) } } },
      () => {},
      { fetchImpl },
    );

    const call = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect((call[1] as RequestInit).headers).toEqual({ Range: "bytes=6-" });
    expect(readFileSync(destPath, "utf8")).toBe(content);
  });

  test("rejects on checksum mismatch, does not install, and does not retry", async () => {
    const content = "real content";
    const destPath = join(testBinDir, "yt-dlp");
    const fetchImpl = fakeFetch(content);

    await expect(
      installDependency(
        { id: "yt-dlp", label: "t", sizeEstimateMb: 1, destPath, source: { kind: "download", url: "https://x/y", checksum: { type: "pinned", sha256: "0".repeat(64) } } },
        () => {},
        { fetchImpl },
      ),
    ).rejects.toThrow(/checksum mismatch/);

    expect(existsSync(destPath)).toBe(false);
    expect((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(1);
  });

  test("retries with backoff on transport failure, then succeeds", async () => {
    const content = "content";
    const destPath = join(testBinDir, "yt-dlp");
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls < 3) throw new Error("network blip");
      return new Response(new TextEncoder().encode(content), { status: 200, headers: { "content-length": String(content.length) } });
    }) as unknown as typeof fetch;

    await installDependency(
      { id: "yt-dlp", label: "t", sizeEstimateMb: 1, destPath, source: { kind: "download", url: "https://x/y", checksum: { type: "pinned", sha256: await sha256(content) } } },
      () => {},
      { fetchImpl, baseDelayMs: 1 },
    );

    expect(calls).toBe(3);
    expect(readFileSync(destPath, "utf8")).toBe(content);
  });

  test("gives up after exhausting retries on persistent transport failure", async () => {
    const destPath = join(testBinDir, "yt-dlp");
    const fetchImpl = (async () => {
      throw new Error("still down");
    }) as unknown as typeof fetch;

    await expect(
      installDependency(
        { id: "yt-dlp", label: "t", sizeEstimateMb: 1, destPath, source: { kind: "download", url: "https://x/y", checksum: { type: "pinned", sha256: "0".repeat(64) } } },
        () => {},
        { fetchImpl, baseDelayMs: 1 },
      ),
    ).rejects.toThrow(/still down/);
  });
});

describe("installDependency (brew)", () => {
  test("installs via brew when Homebrew is on PATH", async () => {
    const fakeBrewDir = mkdtempSync(join(tmpdir(), "fake-brew-"));
    writeFileSync(join(fakeBrewDir, "brew"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(fakeBrewDir, "brew"), 0o755);
    process.env.PATH = fakeBrewDir;
    const progress: InstallProgress[] = [];

    await installDependency(
      { id: "ffmpeg", label: "t", sizeEstimateMb: 1, destPath: join(testBinDir, "ffmpeg"), source: { kind: "brew", formula: "ffmpeg", binaryName: "ffmpeg" } },
      (p) => progress.push(p as InstallProgress),
    );

    expect(runCommandCalls).toContainEqual(["brew", "install", "ffmpeg"]);
    expect(progress.at(-1)?.phase).toBe("done");
    rmSync(fakeBrewDir, { recursive: true, force: true });
  });

  test("falls back to manual instructions when Homebrew is missing", async () => {
    process.env.PATH = "";
    const progress: InstallProgress[] = [];

    await installDependency(
      { id: "ffmpeg", label: "t", sizeEstimateMb: 1, destPath: join(testBinDir, "ffmpeg"), source: { kind: "brew", formula: "ffmpeg", binaryName: "ffmpeg" } },
      (p) => progress.push(p as InstallProgress),
    );

    expect(progress.at(-1)?.phase).toBe("manual");
    expect(runCommandCalls.some((c) => c[0] === "brew")).toBe(false);
  });
});

describe("checkStatus", () => {
  test("reports installed for a dependency already present in binDir", async () => {
    writeFileSync(join(testBinDir, "yt-dlp"), "stub");
    const statuses = await checkStatus();
    expect(statuses.find((s) => s.id === "yt-dlp")?.installed).toBe(true);
  });
});
