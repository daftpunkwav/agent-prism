/**
 * @file check-boundaries
 * @description Lightweight import-boundary checks for the monorepo. Prefer this
 *              over a heavyweight dependency-cruiser install. Failures exit non-zero for CI.
 *
 * Rules:
 * - contracts: no @agentprism/* imports
 * - harness: no @langchain/*
 * - arena-dimensions: only contracts / dimensions / harness (+ foundation);
 *   no @langchain/*, no providers, never the runner
 * - arena-runner: + agent / runtime / arena-dimensions; no @langchain/*, no providers
 * - application: no @agentprism/providers, no @agentprism/evaluation, no @agentprism/harness
 * - evaluation: only contracts / runtime (SDK-free judging and reports)
 * - dimensions: only contracts
 * - tool-registry: only contracts (seam stays below every composer)
 * - tool-builtins: only contracts / environment / tool-registry
 * - driver-run-support: only contracts / environment / runtime / telemetry / harness
 *   (seam + shared run-support; zero backend deps)
 * - driver-native: + driver-run-support (LangChain-free backend)
 * - driver-langchain: + driver-run-support (LC bridge owner; no langgraph)
 * - driver-langgraph: + driver-run-support / driver-langchain (graphs over the bridge)
 *   (driver plugins consume the harness seam, never composers or providers)
 * - driver-autogen/crewai: + driver-run-support (LangChain-free backends, like native)
 * - provider-catalog: only contracts / config / persistence / environment /
 *   runtime / telemetry (SDK-free seam)
 * - provider-langchain: + provider-catalog (SDK adapters stay below composers)
 * - memory-store: only contracts / persistence (atomic file + search index base)
 * - memory-episodic / memory-semantic: only contracts / memory-store
 *   (agent + harness consume memories only through the contracts
 *   MemoryServicePort / MemoryRecallResult types, never the implementations)
 * - memory-service: only contracts / memory-episodic / memory-semantic
 *   (adapter leaf over the two stores)
 * - memory family: no @langchain/*, no providers (SDK-free, deterministic)
 * - apps/web: @agentprism/* only client / ui / arena-view
 *
 * Note: LC/LG conversion lives in packages/drivers (llm-message-bridge).
 *       Native and harness talk only LlmMessage / LlmAdapter.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** @typedef {{ name: string; roots: string[]; forbid: RegExp; allow?: RegExp }} Rule */

/** @type {Rule[]} */
const RULES = [
  {
    name: "contracts → no @agentprism/*",
    roots: ["packages/contracts/contracts/src"],
    forbid: /from\s+["']@agentprism\//,
  },
  {
    name: "harness → no @langchain/*",
    roots: ["packages/harness/harness/src"],
    forbid: /from\s+["']@langchain\//,
  },
  {
    name: "arena-dimensions → only dimensions/harness/foundation",
    roots: ["packages/arena/arena-dimensions/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|dimensions|harness|environment|runtime|telemetry)[^"']+["']/,
  },
  {
    name: "arena family → no @langchain/*",
    roots: ["packages/arena/arena-dimensions/src", "packages/arena/arena-runner/src"],
    forbid: /from\s+["']@langchain\//,
  },
  {
    name: "arena-runner → + agent/arena-dimensions",
    roots: ["packages/arena/arena-runner/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|dimensions|harness|environment|runtime|telemetry|agent|arena-dimensions|tool-mcp)[^"']+["']/,
  },
  {
    name: "application → no providers/evaluation/harness impl",
    roots: ["packages/application/application/src"],
    forbid: /from\s+["']@agentprism\/(providers|evaluation|harness)/,
  },
  {
    name: "evaluation → only contracts/runtime",
    roots: ["packages/evaluation/evaluation/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|runtime)[^"']+["']/,
  },
  {
    name: "evaluation → no SDK",
    roots: ["packages/evaluation/evaluation/src"],
    forbid: /from\s+["']@langchain\//,
  },
  {
    name: "dimensions → only contracts",
    roots: ["packages/dimensions/dimensions/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts)[^"']+["']/,
  },
  {
    name: "tool-registry → only contracts",
    roots: ["packages/tools/tool-registry/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts)[^"']+["']/,
  },
  {
    name: "tool-builtins → only contracts/environment/registry",
    roots: ["packages/tools/tool-builtins/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|environment|tool-registry|tool-symbols)[^"']+["']/,
  },
  {
    name: "context-* → dependency-free",
    roots: [
      "packages/context/context-mentions/src",
      "packages/context/context-instructions/src",
      "packages/context/context-chunking/src",
      "packages/context/context-retrieval/src",
      "packages/context/context-compaction/src",
      "packages/context/context-budget/src",
      "packages/context/context-time/src",
      "packages/context/context-analytics/src",
    ],
    forbid: /from\s+["']@agentprism\/[^"']+["']/,
  },
  {
    name: "session-format → only contracts",
    roots: ["packages/session/session-format/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts)[^"']+["']/,
  },
  {
    name: "session-projection → + session-format",
    roots: ["packages/session/session-projection/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|session-format)[^"']+["']/,
  },
  {
    name: "session-telemetry → only contracts",
    roots: ["packages/session/session-telemetry/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts)[^"']+["']/,
  },
  {
    name: "session-title/outline → only contracts",
    roots: ["packages/session/session-title/src", "packages/session/session-outline/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts)[^"']+["']/,
  },
  {
    name: "session-query → + session-format",
    roots: ["packages/session/session-query/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|session-format)[^"']+["']/,
  },
  {
    name: "tool-symbols → only contracts",
    roots: ["packages/tools/tool-symbols/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts)[^"']+["']/,
  },
  {
    name: "tool-mcp → only contracts/registry",
    roots: ["packages/tools/tool-mcp/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|tool-registry)[^"']+["']/,
  },
  {
    name: "agent → only foundation/harness/tools/sandbox",
    roots: ["packages/agent/agent/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|environment|runtime|telemetry|harness|tool-builtins|tool-registry|tool-mcp|sandbox)[^"']+["']/,
  },
  {
    name: "driver-run-support → only foundation/harness/telemetry",
    roots: ["packages/drivers/driver-run-support/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|environment|runtime|telemetry|harness)[^"']+["']/,
  },
  {
    name: "driver-native → + driver-run-support",
    roots: ["packages/drivers/driver-native/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|environment|runtime|telemetry|harness|driver-run-support)[^"']+["']/,
  },
  {
    name: "driver-autogen/crewai → + driver-run-support",
    roots: ["packages/drivers/driver-autogen/src", "packages/drivers/driver-crewai/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|environment|runtime|telemetry|harness|driver-run-support)[^"']+["']/,
  },
  {
    name: "driver-plan-execute → + driver-run-support",
    roots: ["packages/drivers/driver-plan-execute/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|environment|runtime|telemetry|harness|driver-run-support)[^"']+["']/,
  },
  {
    name: "driver-self-critique → + driver-run-support",
    roots: ["packages/drivers/driver-self-critique/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|environment|runtime|telemetry|harness|driver-run-support)[^"']+["']/,
  },
  {
    name: "driver-langchain → + driver-run-support",
    roots: ["packages/drivers/driver-langchain/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|environment|runtime|telemetry|harness|driver-run-support)[^"']+["']/,
  },
  {
    name: "driver-langgraph → + registry/langchain",
    roots: ["packages/drivers/driver-langgraph/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|environment|runtime|telemetry|harness|driver-run-support|driver-langchain)[^"']+["']/,
  },
  {
    name: "provider-catalog → only foundation/config",
    roots: ["packages/providers/provider-catalog/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|config|persistence|environment|runtime|telemetry)[^"']+["']/,
  },
  {
    name: "provider-langchain → + provider-catalog",
    roots: ["packages/providers/provider-langchain/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|config|persistence|environment|runtime|telemetry|provider-catalog)[^"']+["']/,
  },
  {
    name: "http-runtime → only application/builder/config/contracts",
    roots: ["packages/transport/http-runtime/src"],
    forbid: /from\s+["']@agentprism\/(?!application|builder|config|contracts)[^"']+["']/,
  },
  {
    name: "route-* → only domain deps + http-runtime",
    roots: [
      "packages/transport/route-arena/src",
      "packages/transport/route-builder/src",
      "packages/transport/route-projects/src",
      "packages/transport/route-provider/src",
      "packages/transport/route-settings/src",
      "packages/transport/route-threads/src",
      "packages/transport/route-workspace/src",
      "packages/transport/route-sessions/src",
    ],
    forbid: /from\s+["']@agentprism\/(?!application|builder|config|contracts|http-runtime)[^"']+["']/,
  },
  {
    name: "builder-service → orchestrates turns, no agent",
    roots: ["packages/builder/builder-service/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|persistence|runtime|builder-turns|environment|telemetry)[^"']+["']/,
  },
  {
    name: "builder-turns → execution only",
    roots: ["packages/builder/builder-turns/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|runtime|agent|arena-view|environment|telemetry)[^"']+["']/,
  },
  {
    name: "session → only contracts",
    roots: ["packages/session/session/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts)[^"']+["']/,
  },
  {
    name: "session-persistence → only contracts/persistence/session",
    roots: ["packages/session/session-persistence/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|persistence|session)[^"']+["']/,
  },
  {
    name: "sandbox → only contracts",
    roots: ["packages/sandbox/sandbox/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts)[^"']+["']/,
  },
  {
    name: "memory-store → only contracts/persistence",
    roots: ["packages/memory/memory-store/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|persistence)[^"']+["']/,
  },
  {
    name: "memory-episodic → only contracts/memory-store",
    roots: ["packages/memory/memory-episodic/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|memory-store)[^"']+["']/,
  },
  {
    name: "memory-semantic → only contracts/memory-store",
    roots: ["packages/memory/memory-semantic/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|memory-store)[^"']+["']/,
  },
  {
    name: "memory-service → only contracts/memory family",
    roots: ["packages/memory/memory-service/src"],
    forbid: /from\s+["']@agentprism\/(?!contracts|memory-store|memory-episodic|memory-semantic)[^"']+["']/,
  },
  {
    name: "memory family → no @langchain/*",
    roots: [
      "packages/memory/memory-store/src",
      "packages/memory/memory-episodic/src",
      "packages/memory/memory-semantic/src",
    ],
    forbid: /from\s+["']@langchain\//,
  },
  {
    name: "apps/web → only client/ui/arena-view",
    roots: ["apps/web/src"],
    forbid: /from\s+["']@agentprism\/(?!client|ui|arena-view)[^"']+["']/,
  },
];

function walk(dir) {
  /** @type {string[]} */
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      files.push(...walk(full));
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

let failed = false;
for (const rule of RULES) {
  for (const root of rule.roots) {
    for (const file of walk(path.join(ROOT, root))) {
      const text = fs.readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (rule.forbid.test(line)) {
          failed = true;
          console.error(`[boundaries] ${rule.name}\n  ${path.relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }
}

if (failed) {
  process.exit(1);
}
console.log("[boundaries] ok");
