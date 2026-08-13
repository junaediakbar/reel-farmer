import { useEffect, useState } from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Badge } from "./components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";

interface LicenseStatus {
  valid: boolean;
  mode: "disabled" | "live" | "grace" | "invalid";
  message?: string;
  daysRemaining?: number;
}

interface DepStatus {
  id: string;
  label: string;
  installed: boolean;
}

interface ApiKeyStatus {
  set: boolean;
  preview: string | null;
}

interface AiModelStatus {
  set: boolean;
  model: string | null;
  history?: string[];
}

const PROVIDERS = [
  { value: "deepseek", label: "DeepSeek", keyEndpoint: "/api/settings/deepseek-key", bodyKey: "deepseekApiKey", placeholder: "sk-…" },
  { value: "nvidia", label: "NVIDIA", keyEndpoint: "/api/settings/nvidia-key", bodyKey: "nvidiaApiKey", placeholder: "nvapi-…" },
] as const;

type ProviderValue = (typeof PROVIDERS)[number]["value"];

/** Sentinel SelectItem for a model not in the provider's own /models list (typed by the user). */
const CUSTOM_MODEL = "__custom__";

function modelEndpoint(p: (typeof PROVIDERS)[number]): string {
  return p.value === "deepseek" ? "/api/settings/deepseek-model" : "/api/settings/nvidia-model";
}

function modelsEndpoint(p: (typeof PROVIDERS)[number]): string {
  return p.value === "deepseek" ? "/api/settings/deepseek-models" : "/api/settings/nvidia-models";
}

function SectionCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <section className="glass-panel flex flex-col gap-4 rounded-2xl p-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <span className="material-symbols-outlined">{icon}</span>
        </span>
        <h2 className="text-headline-md text-on-surface">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** Single BYOK card: provider switch (the global "used for analyze" choice), that provider's key, and the analysis model — which must be chosen before a run can identify clips. */
function ProviderKeyCard() {
  const [provider, setProvider] = useState<ProviderValue>("deepseek");
  const [status, setStatus] = useState<ApiKeyStatus | null>(null);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState<AiModelStatus | null>(null);
  const [modelOptions, setModelOptions] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState("");
  const [modelSaving, setModelSaving] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);

  const active = PROVIDERS.find((p) => p.value === provider)!;
  // The dropdown always lists: current model, then recently-used ones the user already picked, then
  // whatever the platform's /models endpoint reports — so the current choice stays visible/selectable
  // even when it isn't in the platform list, and past choices can be switched back to without retyping.
  const current = modelStatus?.set ? (modelStatus.model ?? null) : null;
  const history = modelStatus?.history ?? [];
  const recent = history.filter((m) => m !== current);
  const platformModels = (modelOptions ?? []).filter((m) => m !== current && !history.includes(m));
  const modelValue = current ?? "";

  function refreshStatus(p: (typeof PROVIDERS)[number]) {
    fetch(p.keyEndpoint)
      .then((r) => r.json())
      .then(setStatus);
  }

  /** Loads the saved model (+ recently-used list) and the provider's current /models list (which needs the key set to be non-empty). */
  function loadModelData(p: (typeof PROVIDERS)[number]) {
    setModelOptions(null);
    setModelsError(null);
    fetch(modelsEndpoint(p))
      .then((r) => r.json())
      .then((data: { models?: string[]; error?: string }) => {
        setModelOptions(data.models ?? []);
        setModelsError(data.error ?? null);
      });
    fetch(modelEndpoint(p))
      .then((r) => r.json())
      .then(setModelStatus);
  }

  useEffect(() => {
    fetch("/api/settings/ai-provider")
      .then((r) => r.json())
      .then((data: { provider: ProviderValue }) => {
        const p = PROVIDERS.find((p) => p.value === data.provider) ?? PROVIDERS[0];
        setProvider(p.value);
        refreshStatus(p);
        loadModelData(p);
      });
  }, []);

  // Keep the custom-model input in sync with whatever is saved (prefills "Custom model…" with the
  // current choice) — only touches it when modelStatus changes, never while the user is typing.
  useEffect(() => {
    setCustomModel(modelStatus?.model ?? "");
  }, [modelStatus]);

  async function selectProvider(value: string) {
    const next = PROVIDERS.find((p) => p.value === value)!;
    setProvider(next.value);
    setInput("");
    setError(null);
    setCustomMode(false);
    refreshStatus(next);
    loadModelData(next);
    await fetch("/api/settings/ai-provider", { method: "POST", body: JSON.stringify({ provider: next.value }) });
  }

  async function saveKey(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(active.keyEndpoint, { method: "POST", body: JSON.stringify({ [active.bodyKey]: input }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed to save key");
      setInput("");
      refreshStatus(active);
      // The /models list only resolves once a key exists — reload it right after saving one.
      loadModelData(active);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveModel(model: string) {
    setModelSaving(true);
    setModelError(null);
    try {
      const res = await fetch(modelEndpoint(active), { method: "POST", body: JSON.stringify({ model }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed to save model");
      setCustomMode(false);
      loadModelData(active);
    } catch (err) {
      setModelError(err instanceof Error ? err.message : String(err));
    } finally {
      setModelSaving(false);
    }
  }

  function selectModel(value: string) {
    if (value === CUSTOM_MODEL) {
      setCustomModel(modelStatus?.model ?? ""); // prefill with the current choice so it's easy to tweak
      setCustomMode(true);
      return;
    }
    saveModel(value);
  }

  function saveCustomModel(e: React.FormEvent) {
    e.preventDefault();
    const model = customModel.trim();
    if (!model) return;
    saveModel(model);
  }

  return (
    <SectionCard icon="vpn_key" title="AI provider & model">
      <p className="text-sm text-on-surface-variant">
        Bring your own key — Reel Farmer never bills you for AI usage, it calls the provider with your key.{" "}
        {status?.set ? `Current key: ${status.preview}` : "No key configured yet."}
      </p>

      <Label className="flex flex-col gap-2">
        API platform used for analyze
        <Select value={provider} onValueChange={selectProvider} disabled={saving}>
          <SelectTrigger className="max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>

      <div className="flex flex-col gap-2">
        <Label className="flex flex-col gap-2">
          Model used for analyze
          <Select value={modelValue} onValueChange={selectModel} disabled={modelSaving || modelOptions === null}>
            <SelectTrigger className="max-w-xs">
              <SelectValue placeholder={modelOptions === null ? "Loading models…" : "Select a model…"} />
            </SelectTrigger>
            <SelectContent>
              {current && (
                <SelectGroup>
                  <SelectLabel className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    Current model
                  </SelectLabel>
                  <SelectItem value={current}>{current}</SelectItem>
                </SelectGroup>
              )}
              {recent.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    Recently used
                  </SelectLabel>
                  {recent.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {platformModels.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    {active.label} models
                  </SelectLabel>
                  {platformModels.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              <SelectSeparator />
              <SelectItem value={CUSTOM_MODEL}>Custom model…</SelectItem>
            </SelectContent>
          </Select>
        </Label>
        {!modelStatus?.set && (
          <p className="text-sm text-error">
            No model selected — pick one here (or type a custom model ID) before running a pipeline; clip identification won&apos;t start without it.
          </p>
        )}
        {modelStatus?.set && <p className="text-sm text-on-surface-variant">Current model: {modelStatus.model}</p>}
        {modelsError && modelOptions?.length === 0 && (
          <p className="text-sm text-on-surface-variant">Couldn&apos;t load {active.label} models — {modelsError}</p>
        )}
        {modelOptions?.length === 0 && !modelsError && status?.set && (
          <p className="text-sm text-on-surface-variant">{active.label} exposes no chat models via /models.</p>
        )}

        {customMode && (
          <form onSubmit={saveCustomModel} className="flex flex-col gap-3">
            <Input
              placeholder="Custom model ID"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              disabled={modelSaving}
              className="max-w-xs"
            />
            <Button type="submit" variant="primary" className="self-start" disabled={modelSaving || !customModel.trim()}>
              {modelSaving ? "Saving…" : "Save model"}
            </Button>
          </form>
        )}
        {modelError && <p className="text-sm text-error">{modelError}</p>}
      </div>

      <form onSubmit={saveKey} className="flex flex-col gap-3">
        <Label className="flex flex-col gap-2">
          {status?.set ? `Replace ${active.label} key` : `${active.label} API key`}
          <Input
            type="password"
            placeholder={active.placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={saving}
          />
        </Label>
        {error && <p className="text-sm text-error">{error}</p>}
        <Button type="submit" variant="primary" className="self-start" disabled={saving || !input}>
          {saving ? "Saving…" : "Save key"}
        </Button>
      </form>
    </SectionCard>
  );
}

export function Settings() {
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [deps, setDeps] = useState<DepStatus[] | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refreshLicense() {
    fetch("/api/license/status")
      .then((r) => r.json())
      .then(setLicense);
  }

  useEffect(() => {
    refreshLicense();
    fetch("/api/deps/status")
      .then((r) => r.json())
      .then(setDeps);
  }, []);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setActivating(true);
    try {
      const res = await fetch("/api/license/activate", { method: "POST", body: JSON.stringify({ licenseKey }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Activation failed");
      setLicenseKey("");
      refreshLicense();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActivating(false);
    }
  }

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-10 flex h-20 items-center bg-surface/70 px-6 backdrop-blur-xl">
        <h2 className="text-headline-lg text-primary">Settings</h2>
      </header>

      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-stack-md px-6 pb-24">
        <p className="text-body-lg text-on-surface-variant">License, AI provider &amp; model, and local dependency status.</p>

        <div className="grid grid-cols-1 items-start gap-gutter lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-gutter">
            <SectionCard icon="key" title="License">
              <Badge variant="secondary" className="w-fit">
                BYOK · Flat device license
              </Badge>
              {license?.mode === "disabled" && (
                <p className="text-sm text-on-surface-variant">No license server configured — running unrestricted.</p>
              )}
              {license?.mode === "live" && <p className="text-sm text-on-surface-variant">Active.</p>}
              {license?.mode === "grace" && (
                <p className="text-sm text-on-surface-variant">Offline grace period — {license.daysRemaining} day(s) remaining.</p>
              )}
              {license?.mode === "invalid" && <p className="text-sm text-error">{license.message ?? "License invalid."}</p>}

              {license && license.mode !== "disabled" && license.mode !== "live" && (
                <form onSubmit={activate} className="flex flex-col gap-3">
                  <Label className="flex flex-col gap-2">
                    License key
                    <Input type="text" value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} disabled={activating} />
                  </Label>
                  {error && <p className="text-sm text-error">{error}</p>}
                  <Button type="submit" variant="primary" className="self-start" disabled={activating || !licenseKey}>
                    {activating ? "Activating…" : "Activate"}
                  </Button>
                </form>
              )}
            </SectionCard>

            <ProviderKeyCard />
          </div>

          <SectionCard icon="terminal" title="Local dependencies">
            <div className="flex flex-col gap-3">
              {deps?.map((dep) => (
                <div key={dep.id} className="flex items-center justify-between gap-4 font-semibold">
                  <span className="text-sm text-on-surface">{dep.label}</span>
                  <Badge variant={dep.installed ? "success" : "error"}>
                    <span className="material-symbols-outlined text-[14px]">{dep.installed ? "check_circle" : "cancel"}</span>
                    {dep.installed ? "ready" : "missing"}
                  </Badge>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
