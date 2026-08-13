import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type LicenseStatus = "active" | "revoked";

export interface License {
  key: string;
  plan: string;
  status: LicenseStatus;
  created_at: string;
  last_validated_at: string | null;
}

export class LicenseDb {
  private db: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS licenses (
        key TEXT PRIMARY KEY,
        plan TEXT NOT NULL DEFAULT 'standard',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        last_validated_at TEXT
      )
    `);
  }

  find(key: string): License | null {
    return this.db.query("SELECT * FROM licenses WHERE key = ?").get(key) as License | null;
  }

  insert(key: string, plan: string): void {
    this.db.run("INSERT INTO licenses (key, plan, status, created_at) VALUES (?, ?, 'active', ?)", [
      key,
      plan,
      new Date().toISOString(),
    ]);
  }

  touch(key: string): void {
    this.db.run("UPDATE licenses SET last_validated_at = ? WHERE key = ?", [new Date().toISOString(), key]);
  }

  /** Returns false if the key doesn't exist, so callers (the revoke script) can report that clearly. */
  revoke(key: string): boolean {
    return this.db.run("UPDATE licenses SET status = 'revoked' WHERE key = ?", [key]).changes > 0;
  }
}
