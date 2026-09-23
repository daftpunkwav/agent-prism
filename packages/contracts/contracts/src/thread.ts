/**
 * @file thread
 * @description Durable agent thread contracts: a server-held transcript plus workspace per thread id.
 *
 * Responsibilities:
 * - Define the thread wire views (record + detail with history) and request schemas
 * - Stay the single source for thread shapes shared by the application service and HTTP routes
 *
 * Threads are the fork/resume surface: unlike arena column_sessions (client-held),
 * the transcript here is persisted server-side and survives restarts.
 */

import { z } from "zod";
import { PipelineConfigSchema } from "./arena.js";
import { ToolRoundSchema } from "./history-mode.js";

/** Display title ceiling (matches the ledger's title cap). */
export const THREAD_TITLE_MAX_CHARS = 120;

/** Per-message content ceiling on the wire; the store trims total history separately. */
export const THREAD_MESSAGE_MAX_CHARS = 32_000;

/** One transcript turn half. History stays user/assistant alternating; assistant halves may carry the turn's tool rounds. */
export const ThreadMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(THREAD_MESSAGE_MAX_CHARS),
  tool_rounds: z.array(ToolRoundSchema).optional(),
});
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

/** Wire view of one thread (no transcript; fetch the detail for history). */
export const ThreadViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  running: z.boolean(),
  turn_count: z.number().int().min(0),
  /** Workspace segment reused across turns ("" until the first run creates it). */
  workspace: z.string().default(""),
  /** Parent thread id when this thread is a fork; null for a root thread. */
  fork_of: z.string().nullable(),
  /** Agent config pinned at creation and replayed on every run. */
  config: PipelineConfigSchema,
});
export type ThreadView = z.infer<typeof ThreadViewSchema>;

/** Thread view plus the full transcript (server-held; trimmed to store caps). */
export const ThreadDetailSchema = z.object({
  thread: ThreadViewSchema,
  history: z.array(ThreadMessageSchema),
});
export type ThreadDetail = z.infer<typeof ThreadDetailSchema>;

/** Creates a thread. Config is a full PipelineConfig; omitted fields take pipeline defaults. */
export const ThreadCreateRequestSchema = z.object({
  title: z.string().max(THREAD_TITLE_MAX_CHARS).optional(),
  config: PipelineConfigSchema,
});
export type ThreadCreateRequest = z.infer<typeof ThreadCreateRequestSchema>;

/** Forks a thread: copies the transcript and branches the workspace; the parent stays untouched. */
export const ThreadForkRequestSchema = z.object({
  title: z.string().max(THREAD_TITLE_MAX_CHARS).optional(),
});
export type ThreadForkRequest = z.infer<typeof ThreadForkRequestSchema>;

/** Runs one more turn on the thread (the resume path: history and workspace come from the store). */
export const ThreadRunRequestSchema = z.object({
  question: z.string().min(1).max(4000),
});
export type ThreadRunRequest = z.infer<typeof ThreadRunRequestSchema>;
