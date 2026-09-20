/**
 * @file attachment seeding tests
 * @description Locks attachment seeding on fresh workspaces and skip on follow-up reuse.
 */

import { describe, expect, it } from "vitest";
import { captureDriver, collect, terminalWorkspace, testDeps, testSpec } from "./run-fixtures.js";

describe("runAgentExecution attachment seeding", () => {
  it("attachments seed freshly created workspaces", async () => {
    let seeded: string | undefined;
    const deps = testDeps();
    await collect(
      deps,
      testSpec(captureDriver((ctx) => {
        seeded = ctx.workspace.fs.readFile("seed.txt");
      }), { attachments: [{ name: "seed.txt", content: "hello" }] }),
    );
    expect(seeded).toBe("hello");
  });

  it("follow-up reuse skips seeding so agent edits survive", async () => {
    const deps = testDeps();
    const first = await collect(
      deps,
      testSpec(captureDriver((ctx) => {
        ctx.workspace.fs.writeFile("seed.txt", "agent-edit");
      }), { attachments: [{ name: "seed.txt", content: "v1" }] }),
    );
    const workspaceName = terminalWorkspace(first, "complete");
    let reused: string | undefined;
    await collect(
      deps,
      testSpec(captureDriver((ctx) => {
        reused = ctx.workspace.fs.readFile("seed.txt");
      }), { existingWorkspaceName: workspaceName, attachments: [{ name: "seed.txt", content: "v2" }] }),
    );
    expect(reused).toBe("agent-edit");
  });

});
