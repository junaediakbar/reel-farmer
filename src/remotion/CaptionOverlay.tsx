import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { splitCaptionLines, type CaptionGroup, type CaptionStyle } from "../pipeline/types";

// ponytail: composited via chroma key, not alpha — WebM/VP8 alpha decodes as opaque
// in system ffmpeg (verified: alpha_mode=1 flag set but no alpha plane), which blacked
// out the source footage in composer.ts. Keep in sync with the colorkey value there.
export const CHROMA_KEY = "#00ff00";

export interface CaptionOverlayProps {
  groups: CaptionGroup[];
  style: CaptionStyle;
}

export const CaptionOverlay: React.FC<CaptionOverlayProps> = ({ groups, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const activeGroup = groups.find((g) => t >= g.start && t < g.end);
  if (!activeGroup) return <AbsoluteFill style={{ backgroundColor: CHROMA_KEY }} />;

  const justifyContent = style.position === "top" ? "flex-start" : style.position === "center" ? "center" : "flex-end";
  const lines = splitCaptionLines(activeGroup.words).filter((line) => line.length > 0);

  return (
    <AbsoluteFill style={{ backgroundColor: CHROMA_KEY, justifyContent, alignItems: "center", padding: 48 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          rowGap: style.fontSize * (style.lineHeight - 1),
          maxWidth: "90%",
        }}
      >
        {lines.map((line, li) => (
          <div key={li} style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: "0.4em" }}>
            {line.map((word, i) => {
              const isActive = style.animate && t >= word.start && t < word.end;
              return (
                <span
                  key={i}
                  style={{
                    fontFamily: style.fontFamily,
                    fontSize: style.fontSize,
                    fontWeight: style.fontWeight,
                    color: isActive ? style.activeColor : style.primaryColor,
                    WebkitTextStroke: style.outline ? "2px rgba(0,0,0,0.6)" : undefined,
                  }}
                >
                  {word.word}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
