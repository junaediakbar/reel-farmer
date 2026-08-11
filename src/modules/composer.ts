import { runCommandOrThrow } from "../util/exec";

/** COMPOSE_REEL stage: overlays the transparent caption WebM onto the desilenced clip, final 1080x1920 MP4. */
export async function composeReel(desilencedClipPath: string, overlayWebmPath: string, outPath: string): Promise<void> {
  await runCommandOrThrow([
    "ffmpeg",
    "-y",
    "-i",
    desilencedClipPath,
    "-i",
    overlayWebmPath,
    "-filter_complex",
    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg];[bg][1:v]overlay=0:0:format=auto[v]",
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
