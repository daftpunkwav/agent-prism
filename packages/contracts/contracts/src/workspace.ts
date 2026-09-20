/**
 * @file workspace
 * @description Workspace API contracts: file upsert, listing, content.
 *
 * Responsibilities:
 * - Define the file upsert, entry, and content schemas
 */

import { z } from "zod";

/** Request body for writing/creating a workspace file. */
export const WorkspaceFileUpsertSchema = z.object({
  path: z.string().min(1).max(512),
  content: z.string().max(524_288).default(""),
  create_only: z.boolean().default(false),
});
export type WorkspaceFileUpsert = z.infer<typeof WorkspaceFileUpsertSchema>;

/** Workspace file entry (list view). */
export const WorkspaceFileEntrySchema = z.object({
  path: z.string(),
  size: z.number().int(),
});
export type WorkspaceFileEntry = z.infer<typeof WorkspaceFileEntrySchema>;

/** Workspace file content. */
export const WorkspaceFileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
});
export type WorkspaceFileContent = z.infer<typeof WorkspaceFileContentSchema>;
