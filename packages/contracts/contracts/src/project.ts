/**
 * @file project
 * @description Project persistence contracts: saved experiment archives.
 *
 * Responsibilities:
 * - Define the project schema with per-column results and workspace files
 * - Define the create input and backfill workspace names
 */

import { z } from "zod";
import { CUSTOM_DIMENSION_ID_MAX } from "./custom-dimension.js";

/** Summary of a single column run result within a project. */
export const PipelineRunResultSchema = z.object({
  label: z.string(),
  workspace: z.string(),
  file_count: z.number().int().min(0).default(0),
  files: z.array(z.string()).default([]),
});
export type PipelineRunResult = z.infer<typeof PipelineRunResultSchema>;

/** A saved project (archive of one experiment). */
export const ProjectSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  question: z.string().max(8000),
  // Builtin dimension id or a registered custom dimension id: the same bound the
  // run request accepts, so every pinnable axis can be archived (a narrower cap
  // silently rejected custom ids longer than it while the run itself accepted them).
  dimension: z.string().max(CUSTOM_DIMENSION_ID_MAX),
  created_at: z.string().max(64),
  results: z.array(PipelineRunResultSchema).default([]),
  workspace_files: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  metrics_summary: z.record(z.string(), z.record(z.string(), z.number())).default({}),
});
export type Project = z.infer<typeof ProjectSchema>;

/** Project creation request; workspace_names falls back to pipeline_labels when omitted. */
export const ProjectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  question: z.string().max(8000),
  /** Comparison axis the run used: builtin id or registered custom dimension id. */
  dimension: z.string().max(CUSTOM_DIMENSION_ID_MAX),
  pipeline_labels: z.array(z.string()).min(1).max(16),
  workspace_names: z.array(z.string()).max(16).default([]),
});
export type ProjectCreateInput = z.input<typeof ProjectCreateSchema>;
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;

/** Fills default workspace_names from pipeline_labels. */
export function fillWorkspaceNames(input: ProjectCreateInput): ProjectCreate {
  const workspaceNames = input.workspace_names && input.workspace_names.length > 0
    ? input.workspace_names
    : [...input.pipeline_labels];
  return { ...input, workspace_names: workspaceNames } as ProjectCreate;
}
