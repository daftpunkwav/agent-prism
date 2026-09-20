// @vitest-environment jsdom
/**
 * @file arena client shell tests
 * @description Smoke-locks the Arena page container: stage tabs, composer, and run gating render wired to real hooks.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ArenaMeta } from "@agentprism/client";
import { fetchArenaMeta } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { ArenaClient } from "../src/app/arena/ArenaClient.js";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchArenaMeta: vi.fn(async () => META),
  fetchTemplates: vi.fn(async () => []),
  // The setup drawer mounts the decode panel, which needs a full provider snapshot.
  fetchProvider: vi.fn(async () => PROVIDER),
}));

const PROVIDER = {
  model: "glm-5.3",
  provider_name: "z.ai",
  temperature: 0.5,
  top_p: 0.9,
  frequency_penalty: 0,
  presence_penalty: 0,
  max_output_tokens: 8192,
  max_input_tokens: 128000,
  context_window: 131072,
  endpoints: [{ id: "ep-1" }],
};

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
  ],
  baseline_fields: [],
  baseline_defaults: {},
} as unknown as ArenaMeta;

const metaMock = vi.mocked(fetchArenaMeta);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderArena() {
  return render(
    <I18nProvider initialLocale="en">
      <ArenaClient />
    </I18nProvider>,
  );
}

describe("ArenaClient shell", () => {
  it("renders the stage tabs, the composer, and the gated run button after the meta gate", async () => {
    const en = () => getCatalog("en").arena;
    renderArena();
    // The loading gate shows until meta resolves, then the stage mounts.
    expect(await screen.findByText(en().loading)).toBeDefined();
    const input = await screen.findByLabelText(en().composer.questionAria);
    expect((input as HTMLInputElement).disabled).toBe(false);
    for (const tab of ["results", "report", "diff", "logs", "matrix"] as const) {
      expect(screen.getByRole("tab", { name: en().tab[tab] })).toBeDefined();
    }
    const run = screen.getByRole("button", { name: en().action.run }) as HTMLButtonElement;
    // No question typed yet: the run button must be gated.
    expect(run.disabled).toBe(true);
    await waitFor(() => expect(metaMock).toHaveBeenCalledOnce());
  });

  it("shows the empty results stage before a run", () => {
    renderArena();
    expect(document.querySelectorAll(".column-card")).toHaveLength(0);
  });
});
