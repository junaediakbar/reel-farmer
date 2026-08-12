import { useEffect, useState } from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";

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
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <span className="pointer-events-none absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      <div className="soft-shadow relative flex w-full max-w-md flex-col gap-6 rounded-2xl bg-surface-container-lowest p-8">
        <div className="flex flex-col gap-1 text-center">
          <span className="inner-glow mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary-container">
            <span className="material-symbols-outlined text-on-primary-container">movie</span>
          </span>
          <h1 className="mt-3 text-headline-lg text-on-surface">Activate Reel Farmer</h1>
          <p className="text-on-surface-variant">Enter your license key to continue.</p>
        </div>

        <form onSubmit={activate} className="flex flex-col gap-4">
          <Label className="flex flex-col gap-2">
            License key
            <Input type="text" value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} disabled={activating} />
          </Label>
          {status.message && <p className="text-sm text-error">{status.message}</p>}
          {error && <p className="text-sm text-error">{error}</p>}
          <Button type="submit" variant="primary" disabled={activating || !licenseKey}>
            {activating ? "Activating…" : "Activate"}
          </Button>
        </form>
      </div>
    </div>
  );
}
