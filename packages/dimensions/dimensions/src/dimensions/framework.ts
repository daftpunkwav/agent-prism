/**
 * @file dimensions/framework
 * @description Static fallback options for the framework dimension.
 *
 * Responsibilities:
 * - Export fallback options including the baseline default "native"
 *
 * Overridden at runtime by the driver registry sync.
 */

import type { DimensionOptionTriple } from "../fields.js";

export const FRAMEWORK_OPTIONS: DimensionOptionTriple[] = [
  { field: "framework", value: "native", label: "Native Agent" },
  { field: "framework", value: "plan_execute", label: "Plan-Execute" },
  { field: "framework", value: "self_critique", label: "Self-Critique" },
  { field: "framework", value: "langchain", label: "LangChain" },
  { field: "framework", value: "langgraph", label: "LangGraph" },
  { field: "framework", value: "deepagents", label: "Deep Agents" },
  { field: "framework", value: "openai_agents", label: "OpenAI Agents SDK" },
  { field: "framework", value: "claude_agent_sdk", label: "Claude Agent SDK" },
  { field: "framework", value: "autogen", label: "AutoGen Group-Chat" },
  { field: "framework", value: "crewai", label: "CrewAI Crew" },
];
