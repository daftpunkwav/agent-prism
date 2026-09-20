// @vitest-environment jsdom
/**
 * @file useProjectSave tests
 * @description Locks the project save flow: guards, name fallback, payload shape, and save states.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ColumnState } from "@agentprism/arena-view";
import { createProject } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { useProjectSave } from "../src/app/arena/useProjectSave.js";

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  createProject: vi.fn(),
}));

const createProjectMock = vi.mocked(createProject);

afterEach(() => {
  cleanup();
  // restoreAllMocks no longer resets vi.fn() history in Vitest 4; count
  // assertions in this file need the call log cleared between tests.
  vi.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="en">{children}</I18nProvider>;
}

function renderSave(overrides?: Partial<Parameters<typeof useProjectSave>[0]>) {
  const options = {
    allCompleted: true,
    columnList: [
      { label: "Native", workspace: "ws-a" },
      { label: "LangChain", workspace: "" },
    ] as unknown as ColumnState[],
    dimension: "framework",
    lastRunQuestion: "what is 2+2",
    question: "what is 2+2?",
    ...overrides,
  };
  return renderHook(() => useProjectSave(options), { wrapper });
}

describe("useProjectSave", () => {
  it("allows saving only when the run completed and a real question exists", () => {
    expect(renderSave({ allCompleted: false }).result.current.canSave).toBe(false);
    expect(renderSave({ lastRunQuestion: "   " }).result.current.canSave).toBe(false);
    expect(renderSave().result.current.canSave).toBe(true);
  });

  it("refuses to save an unfinished run", async () => {
    const { result } = renderSave({ allCompleted: false });
    await act(async () => {
      await result.current.save();
    });
    expect(createProjectMock).not.toHaveBeenCalled();
    expect(result.current.saveProjectMsg).toBeNull();
  });

  it("reports a failure when no column carries a workspace", async () => {
    const { result } = renderSave({
      columnList: [{ label: "Native", workspace: "" }] as unknown as ColumnState[],
    });
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.saveProjectMsg).toBe(getCatalog("en").arena.project.noWorkspace);
    expect(result.current.saveProjectOk).toBe(false);
    expect(createProjectMock).not.toHaveBeenCalled();
  });

  it("saves with the explicit name and resets the composer on success", async () => {
    createProjectMock.mockResolvedValue({ project: { name: "My run" } } as never);
    const { result } = renderSave();
    act(() => result.current.setProjectName("My run"));
    await act(async () => {
      await result.current.save();
    });
    expect(createProjectMock).toHaveBeenCalledWith({
      name: "My run",
      question: "what is 2+2",
      dimension: "framework",
      pipeline_labels: ["Native", "LangChain"],
      workspace_names: ["ws-a"],
    });
    expect(result.current.saveProjectOk).toBe(true);
    expect(result.current.saveProjectMsg).toBe(getCatalog("en").arena.project.saved.replace("{name}", "My run"));
    expect(result.current.projectName).toBe("");
  });

  it("falls back to an auto name built from the dimension when the composer is empty", async () => {
    createProjectMock.mockResolvedValue({ project: { name: "auto" } } as never);
    const { result } = renderSave();
    await act(async () => {
      await result.current.save();
    });
    expect(createProjectMock).toHaveBeenCalledWith(expect.objectContaining({ name: expect.stringContaining("framework") }));
  });

  it("surfaces the backend error message on failure", async () => {
    createProjectMock.mockRejectedValue(new Error("disk full"));
    const { result } = renderSave();
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.saveProjectMsg).toBe("disk full");
    expect(result.current.saveProjectOk).toBe(false);
    expect(result.current.savingProject).toBe(false);
  });

  it("ignores a second save while one is in flight", async () => {
    let release!: (value: { project: { name: string } }) => void;
    createProjectMock.mockImplementation(
      (() =>
        new Promise<{ project: { name: string } }>((resolve) => {
          release = resolve;
        })) as never,
    );
    const { result } = renderSave();
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.save();
    });
    await act(async () => {
      await result.current.save();
    });
    release({ project: { name: "done" } });
    await act(async () => {
      await first;
    });
    expect(createProjectMock).toHaveBeenCalledOnce();
  });
});
