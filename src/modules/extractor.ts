import { config } from "../config";
import { runCommandOrThrow } from "../util/exec";

/** Cuts [startSec, endSec) from videoPath into outPath, applying CLIP_SPEED speed-up. */
export async function extractClip(videoPath: string, startSec: number, endSec: number, outPath: string): Promise<void> {
  const duration = endSec - startSec;
  const speed = config.clipSpeed;
  await runCommandOrThrow([
    "ffmpeg",
    "-y",
    "-ss",
    String(startSec),
    "-i",
    videoPath,
    "-t",
    String(duration),
    "-filter:v",
    `setpts=PTS/${speed}`,
    "-filter:a",
    `atempo=${speed}`,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    outPath,
  ]);
}
