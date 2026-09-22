// @vitest-environment jsdom
/**
 * @file trace panel tests
 * @description Locks the builder observability panel: tabs, timeline groups, LLM wire rounds, raw log.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ArenaEvent, BuilderTraceEntry } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { TracePanel, type TraceTab } from "../src/app/builder/TracePanel.js";

const SWAP_ENTRY = {
  id: "swap-1",
  ts: 100,
  kind: "swap",
  title: "framework native → crewai",
  data: { framework: "crewai" },
} as unknown as BuilderTraceEntry;

const REQUEST_ENTRY = {
  id: "req-1",
  ts: 200,
  kind: "llm_request",
  title: "request",
  data: { model: "glm-5.3", messages: [{ role: "user", content: "hi" }], tools: [], params: { temperature: 0.7 } },
} as unknown as BuilderTraceEntry;

const RESPONSE_ENTRY = {
  id: "resp-1",
  ts: 350,
  kind: "llm_response",
  title: "response",
  durationMs: 800,
  data: { text: "hello there", usage: { input_tokens: 10, output_tokens: 5 }, first_token_ms: 120, durationMs: 800 },
} as unknown as BuilderTraceEntry;

const TURN = {
  turn: 1,
  ts: 150,
  user: "build me a widget",
  events: [
    { type: "thought", content: "thinking it through", turn: 1, step: 1 },
  ] as unknown as ArenaEvent[],
};

const en = () => getCatalog("en").builder;

afterEach(cleanup);

function renderPanel(props: { tab: TraceTab; trace?: BuilderTraceEntry[]; turns?: typeof TURN[]; events?: ArenaEvent[] }) {
  const onTabChange = vi.fn();
  render(
    <I18nProvider initialLocale="en">
      <TracePanel
        trace={props.trace ?? []}
        turns={props.turns ?? []}
        events={props.events ?? []}
        tab={props.tab}
        onTabChange={onTabChange}
        workspaceName={null}
      />
    </I18nProvider>,
  );
  return onTabChange;
}

describe("TracePanel", () => {
  it("renders the four tabs and reports tab switches", () => {
    const onTabChange = renderPanel({ tab: "timeline" });
    for (const label of [en().tabTimeline, en().tabLlm, en().tabLog, en().tabWorkspace]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
    fireEvent.click(screen.getByRole("button", { name: en().tabLlm }));
    expect(onTabChange).toHaveBeenCalledWith("llm");
  });

  it("shows the empty timeline, then turn groups and swap banners once data lands", async () => {
    const { rerender } = render(
      <I18nProvider initialLocale="en">
        <TracePanel trace={[]} turns={[]} events={[]} tab="timeline" onTabChange={() => {}} workspaceName={null} />
      </I18nProvider>,
    );
    expect(screen.getByText(en().emptyTrace)).toBeDefined();

    rerender(
      <I18nProvider initialLocale="en">
        <TracePanel trace={[SWAP_ENTRY]} turns={[TURN]} events={[]} tab="timeline" onTabChange={() => {}} workspaceName={null} />
      </I18nProvider>,
    );
    // Chronological order: the earlier swap banner precedes the settled turn.
    expect(screen.getByText(en().swapBanner)).toBeDefined();
    expect(screen.getByText(en().turnLabel.replace("{turn}", "1"))).toBeDefined();
    expect(screen.getByText("build me a widget")).toBeDefined();
    // Flat step rows: each step renders one collapsible row; expanding it
    // reveals the raw segment text directly (no phase group in between). A
    // single settled thought is the turn's final reply row.
    fireEvent.click(screen.getByText(en().phaseSummary.answer));
    expect(await screen.findByText(/thinking it through/)).toBeDefined();
  });

  it("renders the live turn tail separately from settled turns", () => {
    renderPanel({
      tab: "timeline",
      events: [{ type: "thought", content: "live answer tail", turn: 2, step: 1 } as unknown as ArenaEvent],
    });
    expect(screen.getByText(en().liveTrace)).toBeDefined();
    expect(screen.getAllByText(/live answer tail/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders LLM wire rounds with usage, first-token, and latency metadata", () => {
    renderPanel({ tab: "llm", trace: [REQUEST_ENTRY, RESPONSE_ENTRY] });
    expect(screen.getByText(`${en().llmPair} 1`)).toBeDefined();
    expect(screen.getByText(/10→5 tok/)).toBeDefined();
    expect(screen.getByText(/120ms/)).toBeDefined();
    expect(screen.getByText(/800ms/)).toBeDefined();
    const requestBlock = document.querySelector('details[data-side="request"]');
    expect(requestBlock?.textContent).toContain("glm-5.3");
    expect(requestBlock?.textContent).toContain("temp 0.7");
  });

  it("shows the no-traffic placeholder on an empty LLM tab", () => {
    renderPanel({ tab: "llm" });
    expect(screen.getByText(en().noLlmTraffic)).toBeDefined();
  });

  it("merges trace entries and events into the raw log", () => {
    renderPanel({
      tab: "log",
      trace: [REQUEST_ENTRY],
      turns: [TURN],
      events: [{ type: "action", tool: "read", args: { path: "a.ts" }, turn: 2 } as unknown as ArenaEvent],
    });
    expect(document.querySelectorAll(".builder-log-row").length).toBe(3);
    // Log rows label by event kind; tool detail rides in the summary line.
    expect(screen.getByText("action")).toBeDefined();
    expect(screen.getByText(/read\(/)).toBeDefined();
  });

  it("embeds the workspace panel (empty state) on the workspace tab", () => {
    renderPanel({ tab: "workspace" });
    expect(screen.getByText(getCatalog("en").arena.ws.empty)).toBeDefined();
  });
});
