import { useState } from "react";
import { isTooCloseToChromaKey, type CaptionStyle } from "../pipeline/types";
import { CAPTION_PRESETS, CAPTION_PRESET_NAMES } from "./captionPresets";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Switch } from "./components/ui/switch";
import { cn } from "./lib/utils";

const FONT_CHOICES = ["Plus Jakarta Sans", "Arial", "Georgia", "Verdana", "Courier New", "Comic Sans MS"];

// Guarded by isTooCloseToChromaKey (pipeline/types.ts) against the export's chroma-keyer, not by
// avoiding specific shades here — any swatch is safe as long as it clears that check.
const COLOR_SWATCHES = ["#ffffff", "#ffafd3", "#c0c1ff", "#1a237e"];

interface CaptionStyleControlsProps {
  style: CaptionStyle;
  onChange: (patch: Partial<CaptionStyle>) => void;
}

/** Presets/typography/color controls for a `CaptionStyle` — shared by the post-render
 * CaptionEditor sidebar and the pre-export style panel in RunDetail. Word-timing editing stays
 * out of here since it depends on an actual transcript, which only exists post-render. */
export function CaptionStyleControls({ style, onChange }: CaptionStyleControlsProps) {
  const [colorWarning, setColorWarning] = useState<string | null>(null);

  /** Guards the custom color pickers: a text/highlight color too close to the export's chroma-key
   * green gets keyed out along with the background, punching holes in the rendered captions. */
  function updateColor(key: "primaryColor" | "activeColor", hex: string) {
    if (isTooCloseToChromaKey(hex)) {
      setColorWarning("That color is too close to the render's keying color and would leave gaps in the exported captions — pick a different shade.");
      return;
    }
    setColorWarning(null);
    onChange({ [key]: hex });
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Presets */}
      <div>
        <label className="mb-4 block text-label-md text-on-surface">Style Presets</label>
        <div className="grid grid-cols-3 gap-3">
          {CAPTION_PRESET_NAMES.map((name) => {
            const preset = CAPTION_PRESETS[name]!;
            return (
              <button
                key={name}
                type="button"
                onClick={() => onChange(preset)}
                className={cn(
                  "aspect-square rounded-xl border-2 text-sm font-semibold transition-colors",
                  style.fontFamily === preset.fontFamily && style.position === preset.position && style.animate === preset.animate
                    ? "border-primary bg-surface-container-high text-primary"
                    : "border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container",
                )}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Typography */}
      <div>
        <label className="mb-4 block text-label-md text-on-surface">Typography</label>
        <div className="flex flex-col gap-4">
          <Select value={style.fontFamily} onValueChange={(v) => onChange({ fontFamily: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_CHOICES.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex rounded-lg border border-outline-variant bg-surface-container-lowest overflow-hidden">
            {(["top", "center", "bottom"] as const).map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => onChange({ position: pos })}
                className={cn(
                  "flex-1 py-2 text-sm font-semibold capitalize transition-colors",
                  style.position === pos ? "bg-primary-container text-on-primary-container" : "hover:bg-surface-container",
                )}
              >
                {pos}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Size */}
      <div>
        <div className="mb-2 flex justify-between">
          <label className="text-label-sm text-on-surface-variant">Size</label>
          <span className="text-label-sm text-primary">{style.fontSize}px</span>
        </div>
        <input
          type="range"
          min={12}
          max={120}
          value={style.fontSize}
          onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-surface-container-highest accent-primary"
        />
      </div>

      {/* Weight */}
      <div>
        <div className="mb-2 flex justify-between">
          <label className="text-label-sm text-on-surface-variant">Weight</label>
          <span className="text-label-sm text-primary">{style.fontWeight}</span>
        </div>
        <input
          type="range"
          min={400}
          max={900}
          step={100}
          value={style.fontWeight}
          onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-surface-container-highest accent-primary"
        />
      </div>

      {/* Line height */}
      <div>
        <div className="mb-2 flex justify-between">
          <label className="text-label-sm text-on-surface-variant">Line Spacing</label>
          <span className="text-label-sm text-primary">{style.lineHeight.toFixed(1)}×</span>
        </div>
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.1}
          value={style.lineHeight}
          onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-surface-container-highest accent-primary"
        />
      </div>

      {/* Colors */}
      <div>
        <label className="mb-2 block text-label-md text-on-surface">Text Color</label>
        <div className="flex gap-3">
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Text color ${c}`}
              onClick={() => onChange({ primaryColor: c })}
              className={cn(
                "h-8 w-8 rounded-full border border-outline-variant transition-transform hover:scale-110",
                style.primaryColor === c && "ring-2 ring-primary ring-offset-2",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            aria-label="Custom text color"
            value={style.primaryColor}
            onChange={(e) => updateColor("primaryColor", e.target.value)}
            className="h-8 w-8 cursor-pointer rounded-full border border-outline-variant bg-transparent p-0"
          />
        </div>
      </div>

      <div>
        <label className="mb-2 block text-label-md text-on-surface">Highlight Color</label>
        <div className="flex gap-3">
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Highlight color ${c}`}
              onClick={() => onChange({ activeColor: c })}
              className={cn(
                "h-8 w-8 rounded-full border border-outline-variant transition-transform hover:scale-110",
                style.activeColor === c && "ring-2 ring-primary ring-offset-2",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            aria-label="Custom highlight color"
            value={style.activeColor}
            onChange={(e) => updateColor("activeColor", e.target.value)}
            className="h-8 w-8 cursor-pointer rounded-full border border-outline-variant bg-transparent p-0"
          />
        </div>
      </div>
      {colorWarning && <p className="text-sm text-error">{colorWarning}</p>}

      {/* Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-label-md text-on-surface">Dynamic Animation</h4>
          <p className="text-label-sm text-on-surface-variant">Highlight each word as it's spoken</p>
        </div>
        <Switch checked={style.animate} onCheckedChange={(checked) => onChange({ animate: checked })} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-label-md text-on-surface">Text Outline</h4>
          <p className="text-label-sm text-on-surface-variant">Dark stroke around letters for readability</p>
        </div>
        <Switch checked={style.outline} onCheckedChange={(checked) => onChange({ outline: checked })} />
      </div>
    </div>
  );
}
