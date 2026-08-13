import { useState } from "react";
import type { EndingWatermarkOptions, PreProductionOptions, WatermarkOptions, WatermarkPosition } from "../pipeline/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Switch } from "./components/ui/switch";
import { Input } from "./components/ui/input";

interface PreProductionPanelProps {
  runId: string;
  value: PreProductionOptions;
  onChange: (next: PreProductionOptions) => void;
}

const POSITION_LABELS: Record<WatermarkPosition, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
  center: "Center",
};

const POSITIONS = Object.keys(POSITION_LABELS) as WatermarkPosition[];

async function uploadAsset(runId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/runs/${runId}/assets`, { method: "POST", body: form });
  if (!res.ok) throw new Error("Upload failed — use PNG, JPEG, or WebP");
  const { asset } = (await res.json()) as { asset: string };
  return asset;
}

function FileUploadButton({ label, onFile }: { label: string; onFile: (file: File) => void }) {
  return (
    <label className="flex h-9 cursor-pointer items-center gap-1 rounded-lg border border-outline-variant px-3 text-xs font-semibold text-on-surface hover:bg-surface-container-high">
      <span className="material-symbols-outlined text-[16px]">upload</span>
      {label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

function PositionSelect({ value, onChange, label }: { value: WatermarkPosition; onChange: (pos: WatermarkPosition) => void; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as WatermarkPosition)}>
      <SelectTrigger className="w-40" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {POSITIONS.map((pos) => (
          <SelectItem key={pos} value={pos}>
            {POSITION_LABELS[pos]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function OpacitySlider({ value, onChange }: { value: number; onChange: (opacity: number) => void }) {
  return (
    <div>
      <div className="mb-1 flex justify-between">
        <span className="text-label-sm text-on-surface-variant">Opacity</span>
        <span className="text-label-sm text-primary">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0.1}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-surface-container-highest accent-primary"
      />
    </div>
  );
}

/**
 * Optional Pre-Production choices (PRD §1.5/§7.1, G19): custom thumbnail, whole-clip watermark,
 * and an ending watermark/outro shown only in the last few seconds. Every field defaults off —
 * collapsed by default so it never gets in the way of the default full-auto export flow.
 */
export function PreProductionPanel({ runId, value, onChange }: PreProductionPanelProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(next: Partial<PreProductionOptions>) {
    onChange({ ...value, ...next });
  }

  function patchWatermark(next: Partial<WatermarkOptions>) {
    const base: WatermarkOptions = value.watermark ?? { imageAsset: "", position: "bottom-right", opacity: 0.8 };
    patch({ watermark: { ...base, ...next } });
  }

  function patchEndingWatermark(next: Partial<EndingWatermarkOptions>) {
    const base: EndingWatermarkOptions = value.endingWatermark ?? { imageAsset: "", position: "bottom-right", opacity: 0.9, durationSec: 3 };
    patch({ endingWatermark: { ...base, ...next } });
  }

  async function handleUpload(file: File, apply: (asset: string) => void) {
    setError(null);
    try {
      apply(await uploadAsset(runId, file));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const watermarkEnabled = Boolean(value.watermark);
  const endingEnabled = Boolean(value.endingWatermark);

  return (
    <div className="soft-shadow rounded-2xl bg-surface-container-lowest">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-2xl px-4 py-3 text-left"
      >
        <span className="text-label-md text-on-surface-variant">Pre-Production (optional)</span>
        <span className="material-symbols-outlined text-on-surface-variant">{open ? "expand_less" : "expand_more"}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-6 border-t border-outline-variant/20 p-4">
          {error && <p className="text-sm text-error">{error}</p>}

          <div>
            <label className="mb-2 block text-label-sm text-on-surface-variant">Thumbnail</label>
            <div className="flex flex-wrap items-center gap-2">
              <FileUploadButton
                label="Upload image"
                onFile={(file) => handleUpload(file, (asset) => patch({ thumbnailAsset: asset, thumbnailFrameSec: undefined }))}
              />
              <span className="text-xs text-on-surface-variant" title="Seconds into the finished (post-speedup, silence-trimmed) clip">
                or frame at (sec into finished clip)
              </span>
              <Input
                type="number"
                min={0}
                step={0.5}
                className="h-9 w-20"
                placeholder="sec"
                value={value.thumbnailFrameSec ?? ""}
                onChange={(e) => {
                  const sec = e.target.value === "" ? undefined : Number(e.target.value);
                  patch({ thumbnailFrameSec: sec, thumbnailAsset: sec === undefined ? value.thumbnailAsset : undefined });
                }}
              />
              {value.thumbnailAsset && (
                <img
                  src={`/api/runs/${runId}/assets/${value.thumbnailAsset}`}
                  alt="Thumbnail preview"
                  className="h-9 w-9 rounded object-cover"
                />
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-label-sm text-on-surface-variant">Watermark (whole clip)</label>
              <Switch
                checked={watermarkEnabled}
                onCheckedChange={(checked) =>
                  patch({
                    watermark: checked
                      ? { imageAsset: value.watermark?.imageAsset ?? "", position: "bottom-right", opacity: 0.8 }
                      : undefined,
                  })
                }
              />
            </div>
            {watermarkEnabled && value.watermark && (
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <FileUploadButton
                    label={value.watermark.imageAsset ? "Replace logo" : "Upload logo"}
                    onFile={(file) => handleUpload(file, (asset) => patchWatermark({ imageAsset: asset }))}
                  />
                  {value.watermark.imageAsset && (
                    <img
                      src={`/api/runs/${runId}/assets/${value.watermark.imageAsset}`}
                      alt="Watermark preview"
                      className="h-9 w-9 rounded bg-surface-container-high object-contain"
                    />
                  )}
                </div>
                <PositionSelect value={value.watermark.position} onChange={(pos) => patchWatermark({ position: pos })} label="Watermark position" />
                <OpacitySlider value={value.watermark.opacity} onChange={(opacity) => patchWatermark({ opacity })} />
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-label-sm text-on-surface-variant">Ending watermark (outro)</label>
              <Switch
                checked={endingEnabled}
                onCheckedChange={(checked) =>
                  patch({
                    endingWatermark: checked
                      ? { imageAsset: value.endingWatermark?.imageAsset ?? "", position: "bottom-right", opacity: 0.9, durationSec: 3 }
                      : undefined,
                  })
                }
              />
            </div>
            {endingEnabled && value.endingWatermark && (
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <FileUploadButton
                    label={value.endingWatermark.imageAsset ? "Replace image" : "Upload image"}
                    onFile={(file) => handleUpload(file, (asset) => patchEndingWatermark({ imageAsset: asset }))}
                  />
                  {value.endingWatermark.imageAsset && (
                    <img
                      src={`/api/runs/${runId}/assets/${value.endingWatermark.imageAsset}`}
                      alt="Ending watermark preview"
                      className="h-9 w-9 rounded bg-surface-container-high object-contain"
                    />
                  )}
                </div>
                <PositionSelect
                  value={value.endingWatermark.position}
                  onChange={(pos) => patchEndingWatermark({ position: pos })}
                  label="Ending watermark position"
                />
                <OpacitySlider value={value.endingWatermark.opacity} onChange={(opacity) => patchEndingWatermark({ opacity })} />
                <label className="flex items-center gap-2 text-label-sm text-on-surface-variant">
                  Last
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    className="h-9 w-16"
                    value={value.endingWatermark.durationSec}
                    onChange={(e) => patchEndingWatermark({ durationSec: Number(e.target.value) })}
                  />
                  seconds
                </label>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
