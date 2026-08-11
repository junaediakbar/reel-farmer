import { config } from "../config";
import type { SilentInterval } from "../pipeline/types";
import { runCommand, runCommandOrThrow } from "../util/exec";

const SILENCE_START_RE = /silence_start:\s*(-?[\d.]+)/;
const SILENCE_END_RE = /silence_end:\s*(-?[\d.]+)/;

/** Parses ffmpeg's `silencedetect` stderr output into silent intervals. */
export function parseSilenceDetectOutput(stderr: string): SilentInterval[] {
  const intervals: SilentInterval[] = [];
  let pendingStart: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = SILENCE_START_RE.exec(line);
    if (startMatch) {
      pendingStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = SILENCE_END_RE.exec(line);
    if (endMatch && pendingStart !== null) {
      intervals.push({ start: pendingStart, end: Number(endMatch[1]) });
      pendingStart = null;
    }
  }
  return intervals;
}

export async function detectSilence(videoPath: string): Promise<SilentInterval[]> {
  const result = await runCommand([
    "ffmpeg",
    "-i",
    videoPath,
    "-af",
    `silencedetect=noise=${config.silenceThresholdDb}dB:d=${config.silenceMinDuration}`,
    "-f",
    "null",
    "-",
  ]);
  // ffmpeg with -f null exits 0 on success even though it only wrote to stderr; a real failure has non-zero exit.
  if (result.exitCode !== 0) {
    throw new Error(`ffmpeg silencedetect failed (exit ${result.exitCode}): ${result.stderr.slice(0, 2000)}`);
  }
  return parseSilenceDetectOutput(result.stderr);
}

function buildKeepExpression(silent: SilentInterval[]): string {
  if (silent.length === 0) return "1";
  const terms = silent.map((s) => `between(t,${s.start},${s.end})`).join("+");
  return `not(${terms})`;
}

/** Cuts out the given silent intervals, keeping everything else, via ffmpeg select/aselect + concat-by-timestamp. */
export async function removeSilence(videoPath: string, silent: SilentInterval[], outPath: string): Promise<void> {
  const keepExpr = buildKeepExpression(silent);
  await runCommandOrThrow([
    "ffmpeg",
    "-y",
    "-i",
    videoPath,
    "-vf",
    `select='${keepExpr}',setpts=N/FRAME_RATE/TB`,
    "-af",
    `aselect='${keepExpr}',asetpts=N/SR/TB`,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    outPath,
  ]);
}
