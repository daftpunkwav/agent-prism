// @vitest-environment jsdom
/**
 * @file useArenaConfig tests
 * @description Locks the arena config state: meta load, URL prefill, template apply, baseline payload, selections.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ArenaMeta, TaskTemplate } from "@agentprism/client";
import { fetchArenaMeta, fetchTemplates } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { useArenaConfig } from "../src/app/arena/useArenaConfig.js";

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchArenaMeta: vi.fn(),
  fetchTemplates: vi.fn(),
}));

let searchParams = new URLSearchParams();
const metaMock = vi.mocked(fetchArenaMeta);
const templatesMock = vi.mocked(fetchTemplates);

const META = {
  dimensions: [
    {
      id: "framework",
      label: "Framework",
      options: [
        { value: "native", label: "Native" },
        { value: "langchain", label: "LangChain" },
      ],
    },
    {
      id: "reasoning",
      label: "Reasoning",
      options: [
        { value: "react", label: "ReAct" },
        { value: "plan_execute", label: "Plan-Execute" },
      ],
    },
  ],
  baseline_fields: [{ field: "temperature" }, { field: "toolset" }, { field: "reasoning" }],
  baseline_defaults: { temperature: "0.7", model_id: "ep-1" },
} as unknown as ArenaMeta;

const TEMPLATES = [
  {
    id: "tpl-1",
    question: "Explain X",
    category: "open",
    suggested_dimension: "reasoning",
    suggested_selections: ["react"],
  },
] as unknown as TaskTemplate[];

afterEach(() => {
  cleanup();
  searchParams = new URLSearchParams();
  // restoreAllMocks no longer resets vi.fn() history in Vitest 4.
  vi.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="en">{children}</I18nProvider>;
}

function renderConfig(setError = vi.fn()) {
  return { ...renderHook(() => useArenaConfig(setError), { wrapper }), setError };
}

describe("useArenaConfig", () => {
  it("loads meta and templates once and seeds baseline defaults", async () => {
    metaMock.mockResolvedValue(META);
    templatesMock.mockResolvedValue(TEMPLATES);
    const { result } = renderConfig();
    await waitFor(() => expect(result.current.metaLoading).toBe(false));
    expect(result.current.meta).toEqual(META);
    expect(result.current.templates).toEqual(TEMPLATES);
    expect(result.current.baseline).toEqual({ temperature: "0.7", model_id: "ep-1" });
    expect(metaMock).toHaveBeenCalledTimes(1);
    expect(templatesMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces meta load failures through the error banner", async () => {
    metaMock.mockRejectedValue(new Error("boom"));
    templatesMock.mockResolvedValue([]);
    const { result, setError } = renderConfig();
    await waitFor(() => expect(result.current.metaLoading).toBe(false));
    await waitFor(() => expect(setError).toHaveBeenCalledWith(expect.stringContaining("boom")));
  });

  it("stays silent when the load failure is just an abort", async () => {
    metaMock.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    templatesMock.mockResolvedValue([]);
    const { result, setError } = renderConfig();
    await waitFor(() => expect(result.current.metaLoading).toBe(false));
    expect(setError).not.toHaveBeenCalled();
  });

  it("prefills question, dimension, and selections from the URL", async () => {
    searchParams = new URLSearchParams("q=hello&dimension=reasoning&selections=react,plan_execute");
    metaMock.mockResolvedValue(META);
    templatesMock.mockResolvedValue(TEMPLATES);
    const { result } = renderConfig();
    await waitFor(() => expect(result.current.question).toBe("hello"));
    expect(result.current.dimension).toBe("reasoning");
    expect(result.current.activeSelections).toEqual(["react", "plan_execute"]);
  });

  it("applies a URL template only after the template list has settled", async () => {
    searchParams = new URLSearchParams("template=tpl-1");
    metaMock.mockResolvedValue(META);
    let releaseTemplates!: (list: TaskTemplate[]) => void;
    templatesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseTemplates = resolve;
        }),
    );
    const { result } = renderConfig();
    await waitFor(() => expect(result.current.metaLoading).toBe(false));
    // Templates still pending: prefill must wait rather than skip the param.
    expect(result.current.activeTemplateId).toBeNull();
    await act(async () => {
      releaseTemplates(TEMPLATES);
    });
    await waitFor(() => expect(result.current.activeTemplateId).toBe("tpl-1"));
    expect(result.current.question).toBe("Explain X");
    expect(result.current.dimension).toBe("reasoning");
  });

  it("derives the baseline payload with the dimension lock, model exclusion, and allowlist", async () => {
    metaMock.mockResolvedValue(META);
    templatesMock.mockResolvedValue(TEMPLATES);
    const { result } = renderConfig();
    await waitFor(() => expect(result.current.metaLoading).toBe(false));
    act(() => result.current.setBaseline({ temperature: "0.8", toolset: "full", reasoning: "react", model_id: "other" }));
    // Allowlist from baseline_fields admits temperature/toolset/reasoning.
    expect(result.current.baselinePayload).toEqual({ temperature: "0.8", toolset: "full", reasoning: "react" });
    act(() => result.current.setDimension("reasoning"));
    // The active dimension's own field locks out of the baseline.
    expect(result.current.baselinePayload).toEqual({ temperature: "0.8", toolset: "full" });
  });

  it("treats null selections as show-all and supports toggling into explicit sets", async () => {
    metaMock.mockResolvedValue(META);
    templatesMock.mockResolvedValue(TEMPLATES);
    const { result } = renderConfig();
    await waitFor(() => expect(result.current.metaLoading).toBe(false));
    expect(result.current.activeSelections).toEqual(["native", "langchain"]);
    expect(result.current.columnCount).toBe(2);
    expect(result.current.placeholderLabels).toEqual(["Native", "LangChain"]);
    act(() => result.current.toggleSelection("native"));
    expect(result.current.activeSelections).toEqual(["langchain"]);
    expect(result.current.columnCount).toBe(1);
    act(() => result.current.resetDimensionState());
    expect(result.current.activeSelections).toEqual(["native", "langchain"]);
  });

  it("applies a template's localized question, dimension, and selections", async () => {
    metaMock.mockResolvedValue(META);
    templatesMock.mockResolvedValue(TEMPLATES);
    const { result, setError } = renderConfig();
    await waitFor(() => expect(result.current.metaLoading).toBe(false));
    act(() => result.current.applyTemplate(TEMPLATES[0]!));
    // Unknown catalog id → falls back to the backend's canonical question text.
    expect(result.current.question).toBe("Explain X");
    expect(result.current.activeTemplateId).toBe("tpl-1");
    expect(result.current.dimension).toBe("reasoning");
    expect(setError).toHaveBeenCalledWith(null);
  });
});
