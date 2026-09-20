/**
 * @file usage-effectiveness test
 * @description Locks usage aggregation and effectiveness counters.
 */
import { describe, expect, it } from "vitest";
import { EffectivenessLog } from "../src/effectiveness.js";
import { renderEffectivenessReport, renderUsageReport } from "../src/report.js";
import { UsageLedger } from "../src/usage.js";

describe("UsageLedger", () => {
  it("aggregates totals, peaks, and shares", () => {
    const ledger = new UsageLedger();
    expect(ledger.aggregate().turns).toBe(0);
    ledger.record({ turn: 1, tokens: { system: 100, history: 900 } });
    ledger.record({ turn: 2, tokens: { system: 100, tools: 1900, history: -5, retrieval: Number.NaN } });
    const agg = ledger.aggregate();
    expect(agg.turns).toBe(2);
    expect(agg.total).toBe(3000);
    expect(agg.peak).toBe(2000);
    expect(agg.peakTurn).toBe(2);
    expect(agg.bySource.tools).toBe(1900);
    expect(agg.share.system).toBeCloseTo(200 / 3000);
  });
});

describe("EffectivenessLog", () => {
  it("derives keep-rates and drop profiles per strategy", () => {
    const log = new EffectivenessLog();
    expect(log.effectiveness()).toEqual([]);
    log.observe({ strategy: "sliding", inputMessages: 10, outputMessages: 8, inputChars: 1000, outputChars: 800, toolResultsDropped: 0, ledgerEmitted: false });
    log.observe({ strategy: "token_budget", inputMessages: 10, outputMessages: 6, inputChars: 1000, outputChars: 400, toolResultsDropped: 3, ledgerEmitted: true });
    const rows = log.effectiveness();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ strategy: "sliding", applications: 1, meanKeepRate: 0.8 });
    expect(rows[1]).toMatchObject({ totalToolResultsDropped: 3, ledgerRate: 1 });
  });
});

describe("reports", () => {
  it("renders stable text for empty and filled states", () => {
    const ledger = new UsageLedger();
    expect(renderUsageReport(ledger.aggregate())).toContain("no turns");
    ledger.record({ turn: 1, tokens: { tools: 50 } });
    const text = renderUsageReport(ledger.aggregate());
    expect(text).toContain("turns=1");
    expect(text).toContain("tools=50");
    expect(renderEffectivenessReport([])).toContain("no observations");
    const log = new EffectivenessLog();
    log.observe({ strategy: "summary", inputMessages: 5, outputMessages: 5, inputChars: 500, outputChars: 250, toolResultsDropped: 0, ledgerEmitted: false });
    expect(renderEffectivenessReport(log.effectiveness())).toContain("summary: n=1 keep=0.50");
  });
});
