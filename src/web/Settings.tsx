import { useEffect, useState } from "react";

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
    <>
      <header className="topbar">
        <h2>Settings</h2>
      </header>

      <div className="page">
        <span className="blur-orb" style={{ width: 260, height: 260, top: -80, right: -60, background: "rgba(70,72,212,0.1)" }} />
        <p className="subtitle">License, BYOK API key, and local dependency status.</p>

        <div className="settings-grid">
          <div className="settings-col">
            <section className="glass-panel">
              <div className="settings-section-header">
                <span className="settings-section-icon">
                  <span className="material-symbols-outlined">key</span>
                </span>
                <h2>License</h2>
              </div>
              <span className="plan-badge">BYOK · Flat device license</span>
              {license?.mode === "disabled" && <p className="run-stage">No license server configured — running unrestricted.</p>}
              {license?.mode === "live" && <p className="run-stage">Active.</p>}
              {license?.mode === "grace" && (
                <p className="run-stage">Offline grace period — {license.daysRemaining} day(s) remaining.</p>
              )}
              {license?.mode === "invalid" && <p className="error-text">{license.message ?? "License invalid."}</p>}

              {license && license.mode !== "disabled" && license.mode !== "live" && (
                <form onSubmit={activate}>
                  <label>
                    License key
                    <input type="text" value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} disabled={activating} />
                  </label>
                  {error && <p className="error-text">{error}</p>}
                  <button type="submit" className="btn-primary" disabled={activating || !licenseKey}>
                    {activating ? "Activating…" : "Activate"}
                  </button>
                </form>
              )}
            </section>

            <section className="glass-panel">
              <div className="settings-section-header">
                <span className="settings-section-icon">
                  <span className="material-symbols-outlined">vpn_key</span>
                </span>
                <h2>DeepSeek API key</h2>
              </div>
              <p className="run-stage">
                Bring your own DeepSeek key — Reel Farmer never bills you for AI usage, it calls the API with your key.{" "}
                {apiKeyStatus?.set ? `Current key: ${apiKeyStatus.preview}` : "No key configured yet."}
              </p>
              <form onSubmit={saveApiKey}>
                <label>
                  {apiKeyStatus?.set ? "Replace key" : "DeepSeek API key"}
                  <input
                    type="password"
                    placeholder="sk-…"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    disabled={savingApiKey}
                  />
                </label>
                {apiKeyError && <p className="error-text">{apiKeyError}</p>}
                <button type="submit" className="btn-primary" disabled={savingApiKey || !apiKeyInput}>
                  {savingApiKey ? "Saving…" : "Save key"}
                </button>
              </form>
            </section>
          </div>

          <div className="settings-col">
            <section className="glass-panel">
              <div className="settings-section-header">
                <span className="settings-section-icon">
                  <span className="material-symbols-outlined">terminal</span>
                </span>
                <h2>Local dependencies</h2>
              </div>
              {deps?.map((dep) => (
                <div key={dep.id} className="dep-row-main">
                  <span>{dep.label}</span>
                  <span className={`status-badge status-${dep.installed ? "completed" : "failed"}`}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                      {dep.installed ? "check_circle" : "cancel"}
                    </span>
                    {dep.installed ? "ready" : "missing"}
                  </span>
                </div>
              ))}
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
