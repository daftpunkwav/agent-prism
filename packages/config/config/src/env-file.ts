/**
 * @file env-file
 * @description Minimal .env parser returning parsed values only; precedence is enforced by the caller (settings.ts).
 *
 * Responsibilities:
 * - Parse KEY=VALUE lines with optional quoting and an optional `export` prefix
 * - Return parsed values only; never touch process.env directly
 */

import { readFileSync } from "node:fs";
import { ENV_FILE } from "./paths.js";

/** Parses KEY=VALUE lines of a .env file and returns the parsed map. */
export function loadEnvFile(filePath: string = ENV_FILE): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(filePath, "utf-8");
  } catch (error) {
    // A missing file is normal; other read errors (permissions/IO) need a trace
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(`[config] Failed to read .env: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {};
  }
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    // Shell-style `export KEY=value` files are common; the prefix is not part of the key.
    const key = line.slice(0, eq).trim().replace(/^export\s+/i, "");
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== "") values[key] = value;
  }
  return values;
}
