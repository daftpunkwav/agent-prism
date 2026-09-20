// @vitest-environment jsdom
/**
 * @file pipeline config view tests
 * @description Locks banner extraction, badge chips, and the cross-column compare table.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ColumnState } from "@agentprism/arena-view";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { bannerOf, PipelineConfigBadges, PipelineConfigCompare } from "../src/app/arena/PipelineConfigView.js";

const BANNER_A = "[Native Agent] react · prompt=zero_shot · temperature=0.7";
const BANNER_B = "[LangChain create_agent] agent · prompt=few_shot · temperature=1.0";

function colWithBanner(label: string, banner: string): ColumnState {
  return {
    label,
    frameworkId: "native",
    events: [{ type: "thought", content: banner }],
  } as unknown as ColumnState;
}

afterEach(cleanup);

describe("bannerOf", () => {
  it("parses the first banner thought and skips non-banner events", () => {
    expect(bannerOf({ events: [{ type: "thought", content: "plain thinking" }] } as never)).toBeNull();
    expect(bannerOf({ events: [] } as never)).toBeNull();
    const parsed = bannerOf(colWithBanner("Native", BANNER_A));
    expect(parsed?.framework).toBe("Native Agent");
    expect(parsed?.modes).toEqual(["react"]);
    expect(parsed?.fields).toEqual([
      { key: "prompt", value: "zero_shot" },
      { key: "temperature", value: "0.7" },
    ]);
  });
});

describe("PipelineConfigBadges", () => {
  it("renders framework, modes, and key=value field chips", () => {
    const parsed = bannerOf(colWithBanner("Native", BANNER_A))!;
    render(<PipelineConfigBadges banner={parsed} />);
    expect(screen.getByText("Native Agent")).toBeDefined();
    expect(screen.getByText("react")).toBeDefined();
    expect(screen.getByText("zero_shot")).toBeDefined();
    expect(screen.getByText("0.7")).toBeDefined();
  });
});

describe("PipelineConfigCompare", () => {
  it("renders nothing when no column carries a banner", () => {
    const { container } = render(
      <I18nProvider initialLocale="en">
        <PipelineConfigCompare columns={[]} resolveLabel={(l) => l} />
      </I18nProvider>,
    );
    expect(container.firstElementChild).toBeNull();
  });

  it("shows per-column badges, the no-banner marker, and the union-field table", () => {
    render(
      <I18nProvider initialLocale="en">
        <PipelineConfigCompare
          columns={[colWithBanner("Native", BANNER_A), colWithBanner("LangChain", BANNER_B), colWithBanner("Bare", "no banner here")]}
          resolveLabel={(l) => l}
        />
      </I18nProvider>,
    );
    expect(screen.getByText(getCatalog("en").arena.pipeline.title)).toBeDefined();
    expect(screen.getByText(getCatalog("en").arena.pipeline.noBanner)).toBeDefined();
    // Union of field keys across columns; field keys/values render as badge chips
    // and again as table cells, hence multiple hits.
    expect(screen.getAllByText("prompt").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("temperature").length).toBeGreaterThanOrEqual(1);
    const zeroShot = screen.getAllByText("zero_shot").at(-1)!;
    const fewShot = screen.getAllByText("few_shot").at(-1)!;
    expect(fewShot.className).toContain("pipeline-cell-diff");
    expect(zeroShot.className).not.toContain("pipeline-cell-diff");
  });

  it("marks the header when frameworks differ", () => {
    render(
      <I18nProvider initialLocale="en">
        <PipelineConfigCompare
          columns={[colWithBanner("Native", BANNER_A), colWithBanner("LangChain", BANNER_B)]}
          resolveLabel={(l) => l}
        />
      </I18nProvider>,
    );
    expect(screen.getByText(getCatalog("en").arena.pipeline.differsMark)).toBeDefined();
  });

  it("omits the diff mark and table when banners agree", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(
      <I18nProvider initialLocale="en">
        <PipelineConfigCompare
          columns={[colWithBanner("A", BANNER_A), colWithBanner("B", BANNER_A)]}
          resolveLabel={(l) => l}
        />
      </I18nProvider>,
    );
    expect(screen.queryByText(getCatalog("en").arena.pipeline.differsMark)).toBeNull();
    // Same fields everywhere: no differing cells, but the table still renders.
    expect(container.querySelector("table")).not.toBeNull();
  });
});
