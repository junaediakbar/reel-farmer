import { useEffect, useState } from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Badge } from "./components/ui/badge";

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

interface DeepSeekKeyStatus {
  set: boolean;
  preview: string | null;
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

export function Settings() {
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [deps, setDeps] = useState<DepStatus[] | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [apiKeyStatus, setApiKeyStatus] = useState<DeepSeekKeyStatus | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  function refreshLicense() {
    fetch("/api/license/status")
      .then((r) => r.json())
      .then(setLicense);
  }

  function refreshApiKeyStatus() {
    fetch("/api/settings/deepseek-key")
      .then((r) => r.json())
      .then(setApiKeyStatus);
  }

  useEffect(() => {
    refreshLicense();
    refreshApiKeyStatus();
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

  async function saveApiKey(e: React.FormEvent) {
    e.preventDefault();
    setApiKeyError(null);
    setSavingApiKey(true);
    try {
      const res = await fetch("/api/settings/deepseek-key", { method: "POST", body: JSON.stringify({ deepseekApiKey: apiKeyInput }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed to save key");
      setApiKeyInput("");
      refreshApiKeyStatus();
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingApiKey(false);
    }
  }

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-10 flex h-20 items-center bg-surface/70 px-6 backdrop-blur-xl">
        <h2 className="text-headline-lg text-primary">Settings</h2>
      </header>

      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-stack-md px-6 pb-24">
        <p className="text-body-lg text-on-surface-variant">License, BYOK API key, and local dependency status.</p>

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

            <SectionCard icon="vpn_key" title="DeepSeek API key">
              <p className="text-sm text-on-surface-variant">
                Bring your own DeepSeek key — Reel Farmer never bills you for AI usage, it calls the API with your key.{" "}
                {apiKeyStatus?.set ? `Current key: ${apiKeyStatus.preview}` : "No key configured yet."}
              </p>
              <form onSubmit={saveApiKey} className="flex flex-col gap-3">
                <Label className="flex flex-col gap-2">
                  {apiKeyStatus?.set ? "Replace key" : "DeepSeek API key"}
                  <Input
                    type="password"
                    placeholder="sk-…"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    disabled={savingApiKey}
                  />
                </Label>
                {apiKeyError && <p className="text-sm text-error">{apiKeyError}</p>}
                <Button type="submit" variant="primary" className="self-start" disabled={savingApiKey || !apiKeyInput}>
                  {savingApiKey ? "Saving…" : "Save key"}
                </Button>
              </form>
            </SectionCard>
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
