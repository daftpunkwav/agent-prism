// @vitest-environment jsdom
/**
 * @file builder trace panel tests
 * @description Verifies TracePanel wire tab safety against truncated or partial payloads.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { TracePanel } from "../src/app/builder/TracePanel";
import type { BuilderTraceEntry } from "@agentprism/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TracePanel wire resilience", () => {
  it("safely renders truncated wire requests without throwing", () => {
    const trace: BuilderTraceEntry[] = [
      {
        id: "tr-1",
        seq: 1,
        ts: 1000,
        turn: 1,
        kind: "llm_request",
        title: "LLM Request",
        data: {
          truncated: true,
          original_chars: 70000,
          preview: "truncated-payload",
        },
        durationMs: null,
      },
    ];

    expect(() => {
      render(
        <I18nProvider initialLocale="en">
          <TracePanel
            trace={trace}
            turns={[]}
            events={[]}
            tab="llm"
            onTabChange={() => {}}
          />
        </I18nProvider>,
      );
    }).not.toThrow();

    expect(screen.getByText(/round 1/i)).toBeDefined();
    expect(screen.getByText(/0 Messages/i)).toBeDefined();
  });

  it("safely renders wire responses missing token usage", () => {
    const trace: BuilderTraceEntry[] = [
      {
        id: "tr-2",
        seq: 2,
        ts: 2000,
        turn: 1,
        kind: "llm_response",
        title: "LLM Response",
        data: {
          text: "hello world",
          // usage intentionally undefined
        },
        durationMs: 150,
      },
    ];

    expect(() => {
      render(
        <I18nProvider initialLocale="en">
          <TracePanel
            trace={trace}
            turns={[]}
            events={[]}
            tab="llm"
            onTabChange={() => {}}
          />
        </I18nProvider>,
      );
    }).not.toThrow();

    expect(screen.getByText(/150ms/)).toBeDefined();
  });
});
