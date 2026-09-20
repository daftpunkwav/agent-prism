/**
 * @file memory-port
 * @description Ports and data contracts for hierarchical agent memory.
 *
 * Responsibilities:
 * - Define schemas for episodic experience memories (task post-mortems, self-corrections)
 * - Define schemas for semantic factual memories (project conventions, preferences with TTL)
 * - Define ports for memory recording and cross-session retrieval
 *
 * Contracts-layer module: pure schemas and ports, zero internal @agentprism/* dependencies.
 */

import { z } from "zod";

/** One episodic experience entry recorded from an agent execution. */
export const EpisodicMemoryEntrySchema = z.object({
  id: z.string().min(1),
  task: z.string().min(1),
  framework: z.string().default(""),
  model: z.string().default(""),
  success: z.boolean(),
  /** Core strategy or tools used in this experience. */
  keyActions: z.array(z.string()).default([]),
  /** Key lessons, self-corrections, or diagnostic insights learned. */
  lessons: z.string().default(""),
  /** Epoch timestamp in ms when the experience occurred. */
  timestamp: z.number().int().default(0),
  /** Associated workspace or project tag. */
  workspaceTag: z.string().default(""),
});
export type EpisodicMemoryEntry = z.infer<typeof EpisodicMemoryEntrySchema>;

/** One semantic fact or convention retained across sessions. */
export const SemanticFactSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  confidence: z.number().min(0).max(1).default(1.0),
  /** Effective start timestamp (ms epoch). */
  validFrom: z.number().int().default(0),
  /** Optional expiry timestamp (ms epoch; 0 or omitted = indefinite). */
  validUntil: z.number().int().optional(),
  /** Source or context from which the fact was derived. */
  source: z.string().default(""),
});
export type SemanticFact = z.infer<typeof SemanticFactSchema>;

/** Combined recall payload ready for injection into prompt context. */
export const MemoryRecallResultSchema = z.object({
  episodic: z.array(EpisodicMemoryEntrySchema).default([]),
  semantic: z.array(SemanticFactSchema).default([]),
});
export type MemoryRecallResult = z.infer<typeof MemoryRecallResultSchema>;

/** Query options for retrieving relevant memories. */
export interface MemoryRecallOptions {
  limit?: number;
  workspaceTag?: string;
  now?: number;
  threshold?: number;
}

/** Port for hierarchical memory storage and retrieval. */
export interface MemoryServicePort {
  /** Records an episodic task experience. */
  recordEpisodic(entry: Omit<EpisodicMemoryEntry, "id" | "timestamp">): Promise<EpisodicMemoryEntry>;
  /** Recalls relevant episodic experiences matching the given task description. */
  recallEpisodic(taskQuery: string, options?: MemoryRecallOptions): Promise<readonly EpisodicMemoryEntry[]>;
  /** Records or updates a semantic fact. */
  recordSemantic(fact: Omit<SemanticFact, "id">): Promise<SemanticFact>;
  /** Recalls relevant semantic facts given a subject or query. */
  recallSemantic(query: string, options?: MemoryRecallOptions): Promise<readonly SemanticFact[]>;
  /** Composite recall across episodic and semantic memory layers. */
  recallAll(query: string, options?: MemoryRecallOptions): Promise<MemoryRecallResult>;
}
