/**
 * @file builder legacy tool name tests
 * @description Locks the run->bash migration for persisted builder compositions.
 */
import { describe, expect, it } from "vitest";
import { migrateLegacyToolNames } from "../src/builder.js";

describe("migrateLegacyToolNames", () => {
  it("maps the pre-rename run name to bash and passes everything else through", () => {
    expect(migrateLegacyToolNames(["run", "read", "run_job", "bash_session"])).toEqual([
      "bash",
      "read",
      "run_job",
      "bash_session",
    ]);
    expect(migrateLegacyToolNames([])).toEqual([]);
  });
});
