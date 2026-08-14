import type { CaptionStyle } from "../pipeline/types";

/** Named caption style presets shared by the caption editor and the run detail's export flow. */
export const CAPTION_PRESETS: Record<string, CaptionStyle> = {
  Pop: {
    fontFamily: "Arial",
    fontSize: 75,
    fontWeight: 800,
    lineHeight: 0,
    outline: true,
    primaryColor: "#ffffff",
    activeColor: "#ffff00",
    position: "center",
    animate: true,
  },
  Minimal: {
    fontFamily: "Arial",
    fontSize: 44,
    fontWeight: 500,
    lineHeight: 1.3,
    outline: false,
    primaryColor: "#ffffff",
    activeColor: "#ffffff",
    position: "bottom",
    animate: false,
  },
  Elegant: {
    fontFamily: "Georgia",
    fontSize: 52,
    fontWeight: 700,
    lineHeight: 1.25,
    outline: true,
    primaryColor: "#ffd8e7",
    activeColor: "#ffafd3",
    position: "center",
    animate: true,
  },
};

export const CAPTION_PRESET_NAMES = Object.keys(CAPTION_PRESETS);
