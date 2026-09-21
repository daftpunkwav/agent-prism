/**
 * @file paths
 * @description Fixed repository path anchors derived from this file's location.
 *
 * Responsibilities:
 * - Expose REPO_ROOT, the data/runs dirs, and canonical config file paths
 *
 * Four levels up from packages/<family>/<leaf>/(src|dist) is the repo root; business
 * code must not recompute paths from parents or depend on cwd.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));

// Leaf depth is fixed by the uniform family layout: packages/<family>/<leaf>/src
// sits exactly 4 levels below the repo root in both src and dist trees.
export const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");
export const DATA_DIR = path.join(REPO_ROOT, "data");
export const RUNS_DIR = path.join(DATA_DIR, "runs");
export const ENV_FILE = path.join(REPO_ROOT, ".env");
export const PROVIDER_CONFIG_PATH = path.join(DATA_DIR, "provider_config.json");
export const PROJECTS_PATH = path.join(DATA_DIR, "projects.json");
export const BUILDER_SESSIONS_PATH = path.join(DATA_DIR, "builder_sessions.json");
export const BUILDER_TRACES_DIR = path.join(DATA_DIR, "builder_traces");
export const SESSIONS_PATH = path.join(DATA_DIR, "sessions.json");
export const THREADS_PATH = path.join(DATA_DIR, "threads.json");
export const MEMORY_EPISODIC_PATH = path.join(DATA_DIR, "memory_episodic.json");
export const MEMORY_SEMANTIC_PATH = path.join(DATA_DIR, "memory_semantic.json");
export const RUNTIME_KNOBS_PATH = path.join(DATA_DIR, "runtime_knobs.json");
export const SKILL_SETTINGS_PATH = path.join(DATA_DIR, "skill_settings.json");
export const USER_SKILLS_DIR = path.join(DATA_DIR, "skills");
export const MCP_SERVERS_PATH = path.join(DATA_DIR, "mcp_servers.json");
