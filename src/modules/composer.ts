import { getVideoDurationSec, runCommandOrThrow } from "../util/exec";
import type { WatermarkPosition } from "../pipeline/types";

export interface WatermarkFilterOptions {
  imagePath: string;
  position: WatermarkPosition;
  opacity: number;
}

export interface EndingWatermarkFilterOptions extends WatermarkFilterOptions {
  durationSec: number;
}

const WATERMARK_WIDTH_PX = 162;
const WATERMARK_MARGIN_PX = 24;

const POSITION_EXPR: Record<WatermarkPosition, string> = {
  "top-left": `${WATERMARK_MARGIN_PX}:${WATERMARK_MARGIN_PX}`,
  "top-right": `main_w-overlay_w-${WATERMARK_MARGIN_PX}:${WATERMARK_MARGIN_PX}`,
  "bottom-left": `${WATERMARK_MARGIN_PX}:main_h-overlay_h-${WATERMARK_MARGIN_PX}`,
  "bottom-right": `main_w-overlay_w-${WATERMARK_MARGIN_PX}:main_h-overlay_h-${WATERMARK_MARGIN_PX}`,
  center: "(main_w-overlay_w)/2:(main_h-overlay_h)/2",
};

interface ComposeFilterGraph {
  filterComplex: string;
  /** Label to -map at the end — "v" when neither watermark is set. */
  finalLabel: string;
  /** Extra -i inputs beyond [desilenced, overlay], in the order composeReel must pass them. */
  extraInputCount: number;
}

/**
 * Pure filter-graph builder — no ffmpeg needed to test it. `colorkey=0x00ff00:0.02:0.65` replaces
 * the old `0.5:0.05` pair (commit aef685f): that value hard-cut any AA edge pixel more than
 * ~15-45% green-blended straight to fully transparent (measured 12% of glyph-interior pixels
 * eroded away on export), because similarity alone decides full removal — sim=0.5 is half the RGB
 * color space. Real green-plate drift after encoding measures ~0.002 (see caption-generator.ts's
 * render), so similarity only needs to clear that by a wide margin; the removal work is now done by
 * a wide `blend` ramp instead, which reconstructs each edge pixel's true coverage alpha
 * (`(dist-sim)/blend ≈ 1-t` for a pixel that's t-fraction blended toward the key) rather than
 * thresholding it. Verified against DEFAULT_CAPTION_STYLE's white/gold/black-outline colors: mean
 * alpha-reconstruction error drops ~70-80% vs the old pair. Keep this string in sync with
 * pipeline/types.ts's CHROMA_KEY_SIMILARITY/CHROMA_KEY_BLEND and composer.test.ts's assertion.
 */
export function buildComposeFilterGraph(
  watermark?: WatermarkFilterOptions,
  endingWatermark?: EndingWatermarkFilterOptions,
  endingStartSec = 0,
): ComposeFilterGraph {
  const parts = [
    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg]",
    "[1:v]colorkey=0x00ff00:0.02:0.65[fg]",
  ];
  let label = "v";
  let inputIdx = 2;
  let extraInputCount = 0;
  parts.push(`[bg][fg]overlay=0:0[${label}]`);

  if (watermark) {
    const idx = inputIdx++;
    extraInputCount++;
    const next = "vw";
    parts.push(`[${idx}:v]scale=${WATERMARK_WIDTH_PX}:-1,format=rgba,colorchannelmixer=aa=${watermark.opacity}[wm${idx}]`);
    parts.push(`[${label}][wm${idx}]overlay=${POSITION_EXPR[watermark.position]}[${next}]`);
    label = next;
  }

  if (endingWatermark) {
    const idx = inputIdx++;
    extraInputCount++;
    const next = "ve";
    parts.push(
      `[${idx}:v]scale=${WATERMARK_WIDTH_PX}:-1,format=rgba,colorchannelmixer=aa=${endingWatermark.opacity}[wm${idx}]`,
    );
    parts.push(
      `[${label}][wm${idx}]overlay=${POSITION_EXPR[endingWatermark.position]}:enable='gte(t,${endingStartSec.toFixed(2)})'[${next}]`,
    );
    label = next;
  }

  return { filterComplex: parts.join(";"), finalLabel: label, extraInputCount };
}

/** COMPOSE_REEL stage: chroma-keys the caption overlay's green background out and composites it over
 * the desilenced clip, final 1080x1920 MP4 — plus optional user watermark (whole clip) and/or ending
 * watermark (last `durationSec` seconds only), both opt-in per PRD §7.1/G19. */
export async function composeReel(
  desilencedClipPath: string,
  overlayPath: string,
  outPath: string,
  watermark?: WatermarkFilterOptions,
  endingWatermark?: EndingWatermarkFilterOptions,
): Promise<void> {
  const endingStartSec = endingWatermark
    ? Math.max(0, (await getVideoDurationSec(desilencedClipPath)) - endingWatermark.durationSec)
    : 0;
  const { filterComplex, finalLabel } = buildComposeFilterGraph(watermark, endingWatermark, endingStartSec);
  const extraInputs = [watermark?.imagePath, endingWatermark?.imagePath].filter((p): p is string => Boolean(p));

  await runCommandOrThrow([
    "ffmpeg",
    "-y",
    "-i",
    desilencedClipPath,
    "-i",
    overlayPath,
    ...extraInputs.flatMap((p) => ["-i", p]),
    "-filter_complex",
    filterComplex,
    "-map",
    `[${finalLabel}]`,
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

/** Extracts a single frame at frameSec as a JPEG thumbnail — the Pre-Production "pick a frame" thumbnail option. */
export async function extractThumbnailFrame(sourcePath: string, frameSec: number, outPath: string): Promise<void> {
  await runCommandOrThrow(["ffmpeg", "-y", "-ss", String(Math.max(0, frameSec)), "-i", sourcePath, "-frames:v", "1", "-q:v", "3", outPath]);
}
