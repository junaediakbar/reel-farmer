import { chmodSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { config } from "../config";
import { resolveBinary, type ManagedBinary } from "../util/bin-paths";
import { runCommand } from "../util/exec";

export type DepId = "yt-dlp" | "ffmpeg" | "whisper-cli" | "whisper-model";

export interface DepStatus {
  id: DepId;
  label: string;
  installed: boolean;
  sizeEstimateMb: number;
  /** Set when this dependency needs Homebrew and Homebrew isn't on PATH — the UI shows instructions instead of a progress bar. */
  manual?: { reason: string; instructionsUrl: string };
}

export interface InstallProgress {
  id: DepId;
  phase: "downloading" | "verifying" | "extracting" | "installing" | "done" | "failed" | "manual";
  bytesDownloaded?: number;
  bytesTotal?: number;
  message?: string;
}

export type ProgressCallback = (p: InstallProgress) => void;

type ChecksumSource = { type: "pinned"; sha256: string } | { type: "sumsFile"; url: string; assetName: string };

interface DownloadSource {
  kind: "download";
  url: string;
  checksum: ChecksumSource;
  /** Present when the download is an archive that must be extracted (shared libs live alongside the exe). */
  archive?: { binaryName: string };
}

interface BrewSource {
  kind: "brew";
  formula: string;
  binaryName: string;
}

interface DependencySpec {
  id: DepId;
  label: string;
  sizeEstimateMb: number;
  /** Where the installed artifact ends up — a file for single-binary tools, a directory for archive-based ones. */
  destPath: string;
  source: DownloadSource | BrewSource;
}

function brewInstructionsUrl(): string {
  return "https://brew.sh";
}

function ytDlpSpec(): DependencySpec {
  const assetByPlatform: Partial<Record<NodeJS.Platform, string>> = {
    darwin: "yt-dlp_macos",
    win32: "yt-dlp.exe",
    linux: "yt-dlp",
  };
  const asset = assetByPlatform[process.platform] ?? "yt-dlp";
  return {
    id: "yt-dlp",
    label: "yt-dlp (video downloader)",
    sizeEstimateMb: 20,
    destPath: join(config.binDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"),
    source: {
      kind: "download",
      url: `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`,
      checksum: {
        type: "sumsFile",
        url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS",
        assetName: asset,
      },
    },
  };
}

function ffmpegSpec(): DependencySpec {
  if (process.platform === "darwin") {
    return {
      id: "ffmpeg",
      label: "ffmpeg (audio/video processing)",
      sizeEstimateMb: 80,
      destPath: join(config.binDir, "ffmpeg"),
      source: { kind: "brew", formula: "ffmpeg", binaryName: "ffmpeg" },
    };
  }
  // BtbN/FFmpeg-Builds: static builds hosted on GitHub Releases (unlike johnvansickle.com/gyan.dev,
  // this is scriptable — no bot-check page — and it ships a checksums.sha256 alongside every release).
  const linux = process.platform === "linux";
  const asset = linux ? "ffmpeg-master-latest-linux64-gpl.tar.xz" : "ffmpeg-master-latest-win64-gpl.zip";
  return {
    id: "ffmpeg",
    label: "ffmpeg (audio/video processing)",
    sizeEstimateMb: linux ? 80 : 95,
    destPath: join(config.binDir, linux ? "ffmpeg" : "ffmpeg.exe"),
    source: {
      kind: "download",
      url: `https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/${asset}`,
      checksum: {
        type: "sumsFile",
        url: "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/checksums.sha256",
        assetName: asset,
      },
      archive: { binaryName: linux ? "ffmpeg" : "ffmpeg.exe" },
    },
  };
}

function whisperCliSpec(): DependencySpec {
  if (process.platform === "darwin") {
    // whisper.cpp publishes no macOS CLI binary in its GitHub releases (only an xcframework for app
    // embedding) — Homebrew is the only non-build-from-source path here.
    return {
      id: "whisper-cli",
      label: "whisper-cli (speech-to-text)",
      sizeEstimateMb: 5,
      destPath: join(config.binDir, "whisper-cli"),
      source: { kind: "brew", formula: "whisper-cpp", binaryName: "whisper-cli" },
    };
  }
  const linux = process.platform === "linux";
  const asset = linux ? "whisper-bin-ubuntu-x64.tar.gz" : "whisper-bin-x64.zip";
  // whisper.cpp releases don't publish a checksums file, so these were computed once from the genuine
  // v1.9.2 release asset and pinned here. Pinned to a fixed tag (not /latest/) since there's nothing to
  // re-verify a moving target against — bump both the tag and the hash together on a deliberate upgrade.
  const sha256 = linux
    ? "46811a3ecf584307480a220b9ef5ff81b7b22dc41577cbc274ce3afc61f753b1"
    : "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a";
  return {
    id: "whisper-cli",
    label: "whisper-cli (speech-to-text)",
    sizeEstimateMb: linux ? 10 : 8,
    destPath: join(config.binDir, "whisper-cli"),
    source: {
      kind: "download",
      url: `https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/${asset}`,
      checksum: { type: "pinned", sha256 },
      archive: { binaryName: linux ? "whisper-cli" : "whisper-cli.exe" },
    },
  };
}

function whisperModelSpec(): DependencySpec {
  return {
    id: "whisper-model",
    label: "Whisper GGML model (base.en)",
    sizeEstimateMb: 142,
    destPath: config.whisperModelPath,
    source: {
      kind: "download",
      url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
      // From the file's git-LFS pointer on HuggingFace (`.../raw/main/ggml-base.en.bin`) — the host's own
      // record of the blob's hash, not a guess.
      checksum: { type: "pinned", sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002" },
    },
  };
}

export function getDependencySpecs(): DependencySpec[] {
  return [ytDlpSpec(), ffmpegSpec(), whisperCliSpec(), whisperModelSpec()];
}

/** Bun.which() without options snapshots PATH at process start — pass it explicitly so a PATH change (or a test) is picked up live. */
function whichLive(name: string): string | null {
  return Bun.which(name, { PATH: process.env.PATH ?? "" });
}

function isInstalled(spec: DependencySpec): boolean {
  if (spec.id === "whisper-model") return existsSync(spec.destPath);
  const name = spec.id as ManagedBinary;
  return resolveBinary(name) !== name || whichLive(name) !== null;
}

export async function checkStatus(): Promise<DepStatus[]> {
  return getDependencySpecs().map((spec) => {
    const installed = isInstalled(spec);
    const manual =
      !installed && spec.source.kind === "brew" && !whichLive("brew")
        ? { reason: `Homebrew not found — install with: brew install ${spec.source.formula}`, instructionsUrl: brewInstructionsUrl() }
        : undefined;
    return { id: spec.id, label: spec.label, installed, sizeEstimateMb: spec.sizeEstimateMb, manual };
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream() as unknown as AsyncIterable<Uint8Array>) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
}

async function resolveExpectedChecksum(source: ChecksumSource, fetchImpl: typeof fetch): Promise<string> {
  if (source.type === "pinned") return source.sha256;
  const res = await fetchImpl(source.url);
  if (!res.ok) throw new Error(`failed to fetch checksum file ${source.url}: HTTP ${res.status}`);
  const text = await res.text();
  const line = text.split("\n").find((l) => l.trim().endsWith(source.assetName));
  const hash = line?.trim().split(/\s+/)[0];
  if (!hash) throw new Error(`checksum for ${source.assetName} not found in ${source.url}`);
  return hash;
}

/** Resumable download: sends Range from the existing `.part` file's size, so a dropped connection resumes rather than restarting. */
async function downloadWithResume(
  url: string,
  destPath: string,
  id: DepId,
  onProgress: ProgressCallback,
  fetchImpl: typeof fetch,
): Promise<void> {
  const partPath = `${destPath}.part`;
  mkdirSync(dirname(destPath), { recursive: true });
  let offset = existsSync(partPath) ? statSync(partPath).size : 0;

  const response = await fetchImpl(url, offset > 0 ? { headers: { Range: `bytes=${offset}-` } } : {});
  if (!response.ok && response.status !== 206) {
    throw new Error(`download failed for ${id}: HTTP ${response.status}`);
  }
  const resumed = response.status === 206;
  if (!resumed) offset = 0;
  if (!response.body) throw new Error(`download failed for ${id}: empty response body`);

  const contentLength = response.headers.get("content-length");
  const bytesTotal = contentLength ? offset + Number(contentLength) : undefined;

  const out = createWriteStream(partPath, { flags: resumed ? "a" : "w" });
  let bytesDownloaded = offset;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      out.write(chunk);
      bytesDownloaded += chunk.length;
      onProgress({ id, phase: "downloading", bytesDownloaded, bytesTotal });
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    throw err;
  }

  renameSync(partPath, destPath);
}

function findFileRecursive(dir: string, name: string): string | null {
  const hit = (readdirSync(dir, { recursive: true }) as string[]).find((p) => basename(p) === name);
  return hit ? join(dir, hit) : null;
}

/** Extracts via the system `tar` — bsdtar (macOS/Windows) and GNU tar (Linux) both handle .tar.xz/.tar.gz/.zip through the same `-xf` flag. */
async function extractArchive(archivePath: string, destDir: string, binaryName: string): Promise<void> {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  const result = await runCommand(["tar", "-xf", archivePath, "-C", destDir]);
  if (result.exitCode !== 0) throw new Error(`failed to extract ${archivePath}: ${result.stderr.slice(0, 500)}`);

  const found = findFileRecursive(destDir, binaryName);
  if (!found) throw new Error(`extracted ${archivePath} but did not find ${binaryName} inside`);
  if (process.platform !== "win32") chmodSync(found, 0o755);
}

async function installViaDownload(
  spec: DependencySpec,
  source: DownloadSource,
  onProgress: ProgressCallback,
  fetchImpl: typeof fetch,
  baseDelayMs: number,
): Promise<void> {
  const maxRetries = 3;
  let lastError: Error = new Error("installViaDownload: no attempt was made");

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const downloadTarget = source.archive ? `${spec.destPath}.archive` : spec.destPath;
      await downloadWithResume(source.url, downloadTarget, spec.id, onProgress, fetchImpl);

      onProgress({ id: spec.id, phase: "verifying" });
      const expected = await resolveExpectedChecksum(source.checksum, fetchImpl);
      const actual = await sha256File(downloadTarget);
      if (actual !== expected) {
        rmSync(downloadTarget, { force: true });
        throw new Error(`checksum mismatch for ${spec.id}: expected ${expected}, got ${actual}`);
      }

      if (source.archive) {
        onProgress({ id: spec.id, phase: "extracting" });
        await extractArchive(downloadTarget, spec.destPath, source.archive.binaryName);
        rmSync(downloadTarget, { force: true });
      } else {
        chmodSync(downloadTarget, 0o755);
      }

      onProgress({ id: spec.id, phase: "done" });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // A checksum mismatch against a pinned/sums-file hash won't fix itself on retry — fail fast,
      // same as the auth-error fast-fail in clip-identifier.ts's callDeepSeek.
      const isChecksumError = lastError.message.includes("checksum mismatch");
      if (isChecksumError || attempt === maxRetries) {
        onProgress({ id: spec.id, phase: "failed", message: lastError.message });
        throw lastError;
      }
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

async function installViaBrew(spec: DependencySpec, source: BrewSource, onProgress: ProgressCallback): Promise<void> {
  if (!whichLive("brew")) {
    onProgress({
      id: spec.id,
      phase: "manual",
      message: `Homebrew not found. Install manually: brew install ${source.formula} (see ${brewInstructionsUrl()})`,
    });
    return;
  }
  onProgress({ id: spec.id, phase: "installing", message: `brew install ${source.formula}` });
  const result = await runCommand(["brew", "install", source.formula]);
  if (result.exitCode !== 0) {
    onProgress({ id: spec.id, phase: "failed", message: result.stderr.slice(0, 2000) });
    throw new Error(`brew install ${source.formula} failed: ${result.stderr.slice(0, 500)}`);
  }
  onProgress({ id: spec.id, phase: "done" });
}

export interface InstallDependencyOptions {
  fetchImpl?: typeof fetch;
  baseDelayMs?: number;
}

export async function installDependency(
  spec: DependencySpec,
  onProgress: ProgressCallback = () => {},
  opts: InstallDependencyOptions = {},
): Promise<void> {
  if (spec.source.kind === "brew") {
    await installViaBrew(spec, spec.source, onProgress);
    return;
  }
  await installViaDownload(spec, spec.source, onProgress, opts.fetchImpl ?? fetch, opts.baseDelayMs ?? 500);
}

/** Installs every dependency that isn't already present. One failure doesn't block the rest — each is reported via onProgress. */
export async function installAll(onProgress: ProgressCallback = () => {}, opts: InstallDependencyOptions = {}): Promise<void> {
  for (const spec of getDependencySpecs()) {
    if (isInstalled(spec)) {
      onProgress({ id: spec.id, phase: "done", message: "already installed" });
      continue;
    }
    try {
      await installDependency(spec, onProgress, opts);
    } catch {
      // already reported via onProgress phase "failed"/"manual" — keep going.
    }
  }
}
