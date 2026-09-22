/**
 * @file toolTaxonomy
 * @description Tool-name classification for trace renderers: maps one tool name to one display category.
 *
 * Responsibilities:
 * - Re-export the shared classifier so TraceView keeps its local import path
 *
 * The classification table lives in @agentprism/arena-view (phase-groups) so
 * the web TraceView and the phase-summary utility share one source and cannot
 * drift; this file keeps the historical symbols. Inputs may arrive
 * pre-lowercased, but the classifier lowercases internally either way.
 */
export type { ToolDisplayCategory as ToolCategory } from "@agentprism/arena-view";
export { classifyTool as toolCategory } from "@agentprism/arena-view";
