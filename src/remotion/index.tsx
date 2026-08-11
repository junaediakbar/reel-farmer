import { Composition, registerRoot } from "remotion";
import { DEFAULT_CAPTION_STYLE } from "../pipeline/types";
import { CaptionOverlay, type CaptionOverlayProps } from "./CaptionOverlay";

const FPS = 30;

const defaultProps: CaptionOverlayProps = { groups: [], style: DEFAULT_CAPTION_STYLE };

// Remotion's typed <Composition> wants a Zod schema to type inputProps end-to-end; skipping that
// dependency for one composition and casting at this single boundary instead.
const UntypedCaptionOverlay: React.FC<Record<string, unknown>> = (props) => (
  <CaptionOverlay {...(props as unknown as CaptionOverlayProps)} />
);

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="CaptionOverlay"
      component={UntypedCaptionOverlay}
      fps={FPS}
      width={1080}
      height={1920}
      durationInFrames={1}
      defaultProps={defaultProps}
      calculateMetadata={async ({ props }) => {
        const typedProps = props as unknown as CaptionOverlayProps;
        const lastEnd = typedProps.groups.reduce((max, g) => Math.max(max, g.end), 0);
        return { durationInFrames: Math.max(1, Math.round(lastEnd * FPS)) };
      }}
    />
  );
};

registerRoot(RemotionRoot);
