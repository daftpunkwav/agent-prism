/**
 * @file project schema tests
 * @description Locks the project dimension bound against the run-request axis grammar.
 *
 * Responsibilities:
 * - Pin that every dimension id a run can select is also archivable and reloadable
 */

import { describe, expect, it } from "vitest";
import { CUSTOM_DIMENSION_ID_MAX, ProjectCreateSchema, ProjectSchema } from "@agentprism/contracts";

/** Longest axis id the run request accepts: a registered custom dimension at the grammar ceiling. */
const MAX_DIMENSION = "d".repeat(CUSTOM_DIMENSION_ID_MAX);

const createInput = {
  name: "snake experiment",
  question: "write snake",
  dimension: MAX_DIMENSION,
  pipeline_labels: ["native"],
};

describe("project dimension bound", () => {
  it("accepts an axis id at the custom-dimension ceiling on create and on reload", () => {
    expect(ProjectCreateSchema.safeParse(createInput).success).toBe(true);
    // The same payload must survive the persisted schema, otherwise the archive
    // would be written and then silently skipped on the next start.
    const persisted = ProjectSchema.safeParse({
      id: "proj_1",
      name: createInput.name,
      question: createInput.question,
      dimension: createInput.dimension,
      created_at: new Date(0).toISOString(),
    });
    expect(persisted.success).toBe(true);
  });

  it("rejects an axis id past the grammar ceiling on both schemas", () => {
    const tooLong = `${MAX_DIMENSION}e`;
    expect(ProjectCreateSchema.safeParse({ ...createInput, dimension: tooLong }).success).toBe(false);
    expect(
      ProjectSchema.safeParse({
        id: "proj_1",
        name: createInput.name,
        question: createInput.question,
        dimension: tooLong,
        created_at: new Date(0).toISOString(),
      }).success,
    ).toBe(false);
  });
});
