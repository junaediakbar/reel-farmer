import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { config } from "../config";

export const MANAGED_BINARIES = ["yt-dlp", "ffmpeg", "whisper-cli"] as const;
export type ManagedBinary = (typeof MANAGED_BINARIES)[number];

export function isManagedBinary(name: string): name is ManagedBinary {
  return (MANAGED_BINARIES as readonly string[]).includes(name);
}

function withExeSuffix(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

/** Finds a file with this exact name anywhere under dir — archive-based installs (e.g. whisper-cli) keep
 * their shared-library siblings alongside the executable, so the tree can't be flattened. */
function findNested(dir: string, exeName: string): string | null {
  const hit = (readdirSync(dir, { recursive: true }) as string[]).find((p) => basename(p) === exeName);
  return hit ? join(dir, hit) : null;
}

/**
 * Resolves a managed binary to its downloaded copy if one was installed, else falls back to the bare
 * name so it still resolves via PATH — dev machines with these already on PATH see no change.
 * `binDir/<name>` is either the executable itself (single-file tools like yt-dlp) or a directory
 * (archive-based tools like whisper-cli).
 */
export function resolveBinary(name: ManagedBinary): string {
  const dirEntry = join(config.binDir, name);
  if (existsSync(dirEntry) && statSync(dirEntry).isDirectory()) {
    const nested = findNested(dirEntry, withExeSuffix(name));
    if (nested) return nested;
  }

  const fileEntry = join(config.binDir, withExeSuffix(name));
  if (existsSync(fileEntry) && statSync(fileEntry).isFile()) return fileEntry;

  return name;
}
