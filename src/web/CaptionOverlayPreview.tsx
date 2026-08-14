import { splitCaptionLines, type CaptionGroup, type CaptionStyle } from "../pipeline/types";

// Remotion renders the overlay at this native width (src/remotion/index.tsx) — every px value
// below must convert through this constant so the preview is a true scaled-down copy of the
// actual export, not an approximation. cqw (container query width) ties it to the preview box's
// real on-screen size instead of a guessed browser window, so it stays correct at any zoom/window size.
const RENDER_WIDTH_PX = 1080;
function cqw(px: number): string {
  return `${(px / RENDER_WIDTH_PX) * 100}cqw`;
}

interface CaptionOverlayPreviewProps {
  group: CaptionGroup | undefined;
  style: CaptionStyle;
  previewTime: number;
}

/** Absolutely-positioned caption overlay for a video preview box — shared by the post-render
 * CaptionEditor and the pre-export style preview in RunDetail so the two never drift apart.
 * Parent must be `position: relative` with `containerType: "inline-size"` set. */
export function CaptionOverlayPreview({ group, style, previewTime }: CaptionOverlayPreviewProps) {
  if (!group) return null;
  const justifyContent = style.position === "top" ? "flex-start" : style.position === "center" ? "center" : "flex-end";
  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col items-center"
      style={{ justifyContent, alignItems: "center", padding: cqw(48) }}
    >
      <div className="flex flex-col items-center" style={{ rowGap: cqw(style.fontSize * (style.lineHeight - 1)), maxWidth: "90%" }}>
        {splitCaptionLines(group.words)
          .filter((line) => line.length > 0)
          .map((line, li) => (
            <div key={li} className="flex flex-wrap justify-center gap-x-[0.4em]">
              {line.map((w, i) => {
                const isActive = style.animate && previewTime >= w.start && previewTime < w.end;
                return (
                  <span
                    key={i}
                    style={{
                      fontFamily: style.fontFamily,
                      fontSize: cqw(style.fontSize),
                      fontWeight: style.fontWeight,
                      color: isActive ? style.activeColor : style.primaryColor,
                      WebkitTextStroke: style.outline ? `${cqw(2)} #000000` : undefined,
                    }}
                  >
                    {w.word}
                  </span>
                );
              })}
            </div>
          ))}
      </div>
    </div>
  );
}
