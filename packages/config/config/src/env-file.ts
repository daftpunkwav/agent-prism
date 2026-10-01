/**
 * @file env-file
 * @description Minimal .env parser returning parsed values only; precedence is enforced by the caller (settings.ts).
 *
 * Responsibilities:
 * - Parse KEY=VALUE lines with optional quoting and an optional `export` prefix
 * - Merge a .env file under an env map without writing process.env
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
    const first = value[0];
    const balancedQuote =
      (first === '"' && value.endsWith('"')) || (first === "'" && value.endsWith("'"));
    if (balancedQuote && value.length >= 2) {
      value = value.slice(1, -1);
    } else if ((first === '"' || first === "'") && value.length >= 2) {
      // An unbalanced quote stays in the value verbatim (no silent rewriting of
      // operator data), but the likely-mistyped quoting is called out loudly:
      // a quote inside an API key surfaces as a mysterious auth failure later.
      console.warn(`[config] .env value for "${key}" starts with an unmatched quote; keeping it verbatim`);
    }
    if (key !== "") values[key] = value;
  }
  return values;
}

/**
 * Merges a .env file under an env map. The file fills gaps; a defined env value
 * wins, including empty string. Does not write process.env. This is the merge
 * loadSettings and credential lookup both use.
 */
export function mergedEnv(env: NodeJS.ProcessEnv = process.env, envFile: string = ENV_FILE): Record<string, string> {
  const source: Record<string, string> = { ...loadEnvFile(envFile) };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) source[key] = value;
  }
  return source;
}
