import { useEffect, useState } from "react";

interface LicenseStatus {
  valid: boolean;
  mode: "disabled" | "live" | "grace" | "invalid";
  message?: string;
}

/** Gate shown before the rest of the app when a license is invalid or missing. A no-op pass-through
 * (calls onReady immediately) whenever LICENSE_SERVER_URL isn't configured — see src/config.ts. */
export function LicenseGate({ onReady }: { onReady: () => void }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshStatus() {
    const res = await fetch("/api/license/status");
    const data = (await res.json()) as LicenseStatus;
    setStatus(data);
    if (data.valid) onReady();
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setActivating(true);
    try {
      const res = await fetch("/api/license/activate", { method: "POST", body: JSON.stringify({ licenseKey }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Activation failed");
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActivating(false);
    }
  }

  if (status === null || status.valid) return null;

  return (
    <div className="app-shell">
      <div className="main-area">
        <div className="page">
          <header className="page-header">
            <h1>Activate Reel Farmer</h1>
            <p className="subtitle">Enter your license key to continue.</p>
          </header>

          <form className="card" onSubmit={activate}>
            <label>
              License key
              <input type="text" value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} disabled={activating} />
            </label>
            {status.message && <p className="error-text">{status.message}</p>}
            {error && <p className="error-text">{error}</p>}
            <button type="submit" className="btn-primary" disabled={activating || !licenseKey}>
              {activating ? "Activating…" : "Activate"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
