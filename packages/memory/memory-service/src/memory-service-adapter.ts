/**
 * @file memory-service-adapter
 * @description MemoryServicePort over the episodic + semantic stores.
 *
 * Responsibilities:
 * - Forward the port's record/recall calls to the matching store
 * - Combine both stores for recallAll
 *
 * Pure renaming adapter: the two stores already speak the port's record shapes;
 * this class exists so the composition root can inject one MemoryServicePort
 * built from concrete file-backed stores.
 */

import type {
  EpisodicMemoryEntry,
  MemoryRecallOptions,
  MemoryRecallResult,
  MemoryServicePort,
  SemanticFact,
} from "@agentprism/contracts";
import type { EpisodicMemory } from "@agentprism/memory-episodic";
import type { SemanticMemory } from "@agentprism/memory-semantic";

/** Stores the adapter forwards to (constructed by the composition root with file paths). */
export interface MemoryServiceAdapterOptions {
  episodic: EpisodicMemory;
  semantic: SemanticMemory;
}

/** Bridges the episodic + semantic stores into the neutral memory port. */
export class MemoryServiceAdapter implements MemoryServicePort {
  private readonly episodic: EpisodicMemory;
  private readonly semantic: SemanticMemory;

  constructor(options: MemoryServiceAdapterOptions) {
    this.episodic = options.episodic;
    this.semantic = options.semantic;
  }

  recordEpisodic(entry: Omit<EpisodicMemoryEntry, "id" | "timestamp">): Promise<EpisodicMemoryEntry> {
    return this.episodic.recordExperience(entry);
  }

  recallEpisodic(taskQuery: string, options?: MemoryRecallOptions): Promise<readonly EpisodicMemoryEntry[]> {
    return this.episodic.recallExperiences(taskQuery, options);
  }

  recordSemantic(fact: Omit<SemanticFact, "id">): Promise<SemanticFact> {
    return this.semantic.recordFact(fact);
  }

  recallSemantic(query: string, options?: MemoryRecallOptions): Promise<readonly SemanticFact[]> {
    return this.semantic.recallFacts(query, options);
  }

  async recallAll(query: string, options?: MemoryRecallOptions): Promise<MemoryRecallResult> {
    const [episodic, semantic] = await Promise.all([
      this.episodic.recallExperiences(query, options),
      this.semantic.recallFacts(query, options),
    ]);
    return { episodic: [...episodic], semantic: [...semantic] };
  }
}
