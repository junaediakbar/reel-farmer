import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionGroup, CaptionStyle } from "../pipeline/types";

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

  return (
    <AbsoluteFill style={{ backgroundColor: CHROMA_KEY, justifyContent, alignItems: "center", padding: 48 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0.4em", maxWidth: "90%" }}>
        {activeGroup.words.map((word, i) => {
          const isActive = style.animate && t >= word.start && t < word.end;
          return (
            <span
              key={i}
              style={{
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                fontWeight: 800,
                color: isActive ? style.activeColor : style.primaryColor,
                WebkitTextStroke: "2px rgba(0,0,0,0.6)",
              }}
            >
              {word.word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
