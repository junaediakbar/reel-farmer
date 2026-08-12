import { runCommandOrThrow } from "../util/exec";

/** COMPOSE_REEL stage: chroma-keys the caption overlay's green background out and composites it over the desilenced clip, final 1080x1920 MP4. */
export async function composeReel(desilencedClipPath: string, overlayPath: string, outPath: string): Promise<void> {
  await runCommandOrThrow([
    "ffmpeg",
    "-y",
    "-i",
    desilencedClipPath,
    "-i",
    overlayPath,
    "-filter_complex",
    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg];[1:v]colorkey=0x00ff00:0.2:0.1[fg];[bg][fg]overlay=0:0[v]",
    "-map",
    "[v]",
    "-map",
    "0:a",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-pix_fmt",
    "yuv420p",
    outPath,
  ]);
}
