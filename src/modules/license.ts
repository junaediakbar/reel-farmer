import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config, LICENSE_GRACE_PERIOD_DAYS, licenseServerUrl } from "../config";
import { log } from "../logger";

interface LicenseCache {
  licenseKey: string;
  plan?: string;
  lastValidatedAt: string;
}

export type LicenseMode = "disabled" | "live" | "grace" | "invalid";

export interface LicenseStatus {
  valid: boolean;
  mode: LicenseMode;
  message?: string;
  daysRemaining?: number;
}

function friendlyLicenseError(detail: string): Error {
  return new Error(`License check failed: ${detail}. Contact support if this persists.`);
}

function readCache(): LicenseCache | null {
  if (!existsSync(config.licenseCachePath)) return null;
  try {
    return JSON.parse(readFileSync(config.licenseCachePath, "utf8")) as LicenseCache;
  } catch {
    return null;
  }
}

function writeCache(cache: LicenseCache): void {
  writeFileSync(config.licenseCachePath, JSON.stringify(cache));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CallLicenseServerOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
}

interface ValidateResponse {
  valid: boolean;
  reason?: string;
  plan?: string;
}

/** Calls the license server's /validate endpoint with exponential backoff on transport/5xx errors. Auth (401/403) fails fast. */
export async function callLicenseServer(licenseKey: string, opts: CallLicenseServerOptions = {}): Promise<ValidateResponse> {
  const { maxRetries = 3, baseDelayMs = 500, fetchImpl = fetch } = opts;
  const baseUrl = licenseServerUrl();
  if (!baseUrl) throw friendlyLicenseError("no LICENSE_SERVER_URL configured");

  let lastError: Error = new Error("callLicenseServer: no attempt was made");
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchImpl(`${baseUrl}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseKey }),
      });

      if (response.status === 401 || response.status === 403) {
        throw friendlyLicenseError(`license key rejected (HTTP ${response.status})`);
      }
      if (!response.ok) {
        throw new Error(`license server returned HTTP ${response.status}`);
      }
      return (await response.json()) as ValidateResponse;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isAuthError = lastError.message.includes("rejected");
      if (isAuthError || attempt === maxRetries) throw lastError;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

/** Startup + periodic license check: live server result, falling back to a cached grace period when unreachable. */
export async function checkLicense(opts?: CallLicenseServerOptions): Promise<LicenseStatus> {
  if (!licenseServerUrl()) return { valid: true, mode: "disabled" };

  const cache = readCache();
  if (!cache) return { valid: false, mode: "invalid", message: "no license key configured" };

  try {
    const result = await callLicenseServer(cache.licenseKey, opts);
    if (!result.valid) return { valid: false, mode: "invalid", message: result.reason ?? "license key is not valid" };
    writeCache({ ...cache, plan: result.plan ?? cache.plan, lastValidatedAt: new Date().toISOString() });
    return { valid: true, mode: "live" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("rejected")) return { valid: false, mode: "invalid", message: "license key is not valid" };

    const daysSince = (Date.now() - new Date(cache.lastValidatedAt).getTime()) / 86_400_000;
    const daysRemaining = LICENSE_GRACE_PERIOD_DAYS - daysSince;
    if (daysRemaining > 0) {
      log("warn", "license server unreachable, using cached grace period", { daysRemaining: Math.floor(daysRemaining) });
      return { valid: true, mode: "grace", daysRemaining: Math.floor(daysRemaining) };
    }
    return { valid: false, mode: "invalid", message: "cannot reach license server and grace period expired" };
  }
}

/** Activates a license key: validates it against the server and persists it on success. Throws on failure — caller shows the error. */
export async function activateLicense(licenseKey: string, opts?: CallLicenseServerOptions): Promise<LicenseStatus> {
  const result = await callLicenseServer(licenseKey, opts);
  if (!result.valid) throw friendlyLicenseError(result.reason ?? "license key is not valid");
  writeCache({ licenseKey, plan: result.plan, lastValidatedAt: new Date().toISOString() });
  return { valid: true, mode: "live" };
}
