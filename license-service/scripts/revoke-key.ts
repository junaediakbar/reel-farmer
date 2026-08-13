#!/usr/bin/env bun
// Usage: bun run revoke-key <license-key>
import { config } from "../src/config";
import { LicenseDb } from "../src/db";

const key = process.argv[2];
if (!key) {
  console.error("Usage: bun run revoke-key <license-key>");
  process.exit(1);
}

const db = new LicenseDb(config.dbPath);
console.log(db.revoke(key) ? `revoked ${key}` : `key not found: ${key}`);
