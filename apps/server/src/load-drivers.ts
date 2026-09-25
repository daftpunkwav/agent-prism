/**
 * @file load-drivers
 * @description Framework driver composition for the server host.
 *
 * Responsibilities:
 * - Own the builtin backend loader list (single source for composition)
 * - Register drivers best-effort and fail fast when none is available
 *
 * The only module allowed to instantiate backend drivers; backends warn and
 * skip individually so one broken transport cannot take down the runtime.
 *
 * The DRIVERS env var optionally restricts the set (comma-separated,
 * case-insensitive, e.g. DRIVERS=native,plan_execute,self_critique to skip
 * the heavy LangChain/LangGraph imports for a fast local loop). Unset means
 * all builtins. Unknown names warn and are ignored.
 */

import { FrameworkDriverRegistry, registerDriversBestEffort, type DriverLoader } from "@agentprism/driver-run-support";

/** Builtin backend loaders: fresh in-process, loop variants, LangChain, LangGraph, group chat. */
export const builtinDriverLoaders: readonly DriverLoader[] = [
  { name: "Native", load: () => import("@agentprism/driver-native").then((m) => new m.NativeDriver()) },
  {
    name: "PlanExecute",
    load: () => import("@agentprism/driver-plan-execute").then((m) => new m.PlanExecuteDriver()),
  },
  {
    name: "SelfCritique",
    load: () => import("@agentprism/driver-self-critique").then((m) => new m.SelfCritiqueDriver()),
  },
  {
    name: "LangChain",
    load: () => import("@agentprism/driver-langchain").then((m) => new m.LangChainDriver()),
  },
  {
    name: "LangGraph",
    load: () => import("@agentprism/driver-langgraph").then((m) => new m.LangGraphDriver()),
  },
  {
    name: "AutoGen",
    load: () => import("@agentprism/driver-autogen").then((m) => new m.AutogenDriver()),
  },
  {
    name: "CrewAI",
    load: () => import("@agentprism/driver-crewai").then((m) => new m.CrewAIDriver()),
  },
];

/** Normalizes a driver name for DRIVERS matching: lowercased, separators stripped. */
function normalizeDriverName(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, "");
}

/**
 * Selects the builtin loaders enabled by the DRIVERS env var.
 * @returns The enabled loaders (all builtins when DRIVERS is unset/blank).
 */
export function selectDriverLoaders(env = process.env["DRIVERS"]): readonly DriverLoader[] {
  if (env === undefined || env.trim() === "") return builtinDriverLoaders;
  const raw = env
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const wanted = new Set(raw.map(normalizeDriverName));
  const selected = builtinDriverLoaders.filter((loader) => wanted.has(normalizeDriverName(loader.name)));
  const known = new Set(builtinDriverLoaders.map((loader) => normalizeDriverName(loader.name)));
  for (const token of raw) {
    if (!known.has(normalizeDriverName(token))) {
      console.warn(`[server] DRIVERS: unknown driver "${token}" ignored (known: ${builtinDriverLoaders.map((loader) => loader.name).join(", ")})`);
    }
  }
  return selected;
}

/**
 * Registers the builtin drivers and fails fast when none registers:
 * running the Arena with zero drivers can only produce opaque failures later.
 */
export async function registerFrameworkDrivers(): Promise<FrameworkDriverRegistry> {
  const registry = new FrameworkDriverRegistry();
  const loaders = selectDriverLoaders();
  // A DRIVERS filter matching zero known loaders is a configuration error,
  // not an empty backend set: say so instead of the generic empty-registry message.
  if (loaders.length === 0) {
    throw new Error(
      `DRIVERS=${JSON.stringify(process.env["DRIVERS"])} selected zero known drivers ` +
        `(known: ${builtinDriverLoaders.map((loader) => loader.name).join(", ")}): refusing to start`,
    );
  }
  await registerDriversBestEffort(registry, loaders);
  if (registry.listAvailable().length === 0) {
    throw new Error("No framework drivers available: at least one driver must register successfully to run Arena");
  }
  return registry;
}
