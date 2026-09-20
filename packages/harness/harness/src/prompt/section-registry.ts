/**
 * @file section-registry
 * @description In-memory registry of PromptSection contributors.
 *
 * Responsibilities:
 * - Register sections and fold them in a fixed order
 * - Fail closed on unknown ids during lookup
 */

import type { PipelineConfig, PromptSection, PromptSectionRegistry } from "@agentprism/contracts";
import { UnknownPromptConfigError } from "./errors.js";

type SectionKind = "profile" | "reasoning" | "harness" | "context_hint";

/** Mutable registry keyed by kind + id (e.g. profile:zero_shot). */
export class MapPromptSectionRegistry implements PromptSectionRegistry {
  private readonly sections = new Map<string, PromptSection>();

  register(section: PromptSection): void {
    if (section.id.trim() === "") {
      throw new TypeError("PromptSection.id must be non-empty");
    }
    this.sections.set(section.id, section);
  }

  /** Resolves the ordered sections for one column; a missing section throws (all four slots are mandatory, no optional-slot generality). */
  resolve(config: PipelineConfig): PromptSection[] {
    const keys: Array<{ kind: SectionKind; id: string }> = [
      { kind: "profile", id: `profile:${config.prompt_profile}` },
      { kind: "context_hint", id: `context_hint:${config.context}` },
      { kind: "harness", id: `harness:${config.harness}` },
      { kind: "reasoning", id: `reasoning:${config.reasoning}` },
    ];
    const resolved: PromptSection[] = [];
    for (const entry of keys) {
      const section = this.sections.get(entry.id);
      if (section === undefined) {
        const field = entry.kind === "context_hint" ? "context" : entry.kind;
        const value = entry.id.slice(entry.kind.length + 1);
        throw new UnknownPromptConfigError(field, value);
      }
      resolved.push(section);
    }
    return resolved;
  }

  listIds(): string[] {
    return [...this.sections.keys()].sort();
  }
}
