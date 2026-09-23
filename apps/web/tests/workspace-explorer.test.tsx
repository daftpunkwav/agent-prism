// @vitest-environment jsdom
/**
 * @file workspace explorer tests
 * @description Locks the full-stage explorer: attribution switching drives the
 *              hosted panel, Escape closes, and the empty state hosts nothing.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { WorkspaceExplorer } from "../src/app/arena/WorkspaceExplorer.js";
import { WorkspacePanel } from "../src/app/arena/WorkspacePanel.js";

vi.mock("../src/app/arena/WorkspacePanel.js", () => ({
  WorkspacePanel: vi.fn(() => <div data-testid="hosted-panel" />),
}));

// jsdom ships no layout engine: stub the scroll helper the select popup calls on open.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const panelMock = vi.mocked(WorkspacePanel);

const en = () => getCatalog("en").arena;

const CHOICES = [
  { label: "Native", workspace: "ws-native" },
  { label: "LangChain", workspace: "ws-lc" },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderExplorer(props?: {
  choices?: typeof CHOICES;
  onClose?: () => void;
  focusLabel?: string | null;
  onFocusChange?: (label: string) => void;
}) {
  return render(
    <I18nProvider initialLocale="en">
      <WorkspaceExplorer
        choices={props?.choices ?? CHOICES}
        focusLabel={props?.focusLabel ?? null}
        onFocusChange={props?.onFocusChange ?? (() => {})}
        resolveLabel={(label) => label}
        running={false}
        refreshToken={0}
        onClose={props?.onClose ?? (() => {})}
      />
    </I18nProvider>,
  );
}

describe("WorkspaceExplorer", () => {
  it("hosts the focused column's workspace (defaulting to the first choice)", () => {
    renderExplorer();
    expect(panelMock).toHaveBeenCalled();
    const initial = panelMock.mock.calls.at(-1)![0]!;
    expect(initial.workspaceName).toBe("ws-native");
    expect(initial.ownerLabel).toBe("Native");
  });

  it("reports the picked attribution and hosts its workspace when the parent refocuses", async () => {
    const onFocusChange = vi.fn();
    const { rerender } = renderExplorer({ onFocusChange });
    fireEvent.click(screen.getByRole("button", { name: en().drawer.pickWorkspaceAria }));
    fireEvent.click(await screen.findByRole("option", { name: "LangChain" }));
    expect(onFocusChange).toHaveBeenCalledWith("LangChain");

    // Controlled focus: the panel follows once the parent commits the label.
    rerender(
      <I18nProvider initialLocale="en">
        <WorkspaceExplorer
          choices={CHOICES}
          focusLabel="LangChain"
          onFocusChange={onFocusChange}
          resolveLabel={(label) => label}
          running={false}
          refreshToken={0}
          onClose={() => {}}
        />
      </I18nProvider>,
    );
    const switched = panelMock.mock.calls.at(-1)![0]!;
    expect(switched.workspaceName).toBe("ws-lc");
    expect(switched.ownerLabel).toBe("LangChain");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderExplorer({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders the empty hint and hosts no panel when no column has a workspace", () => {
    renderExplorer({ choices: [] });
    expect(screen.getByText(en().drawer.emptyWorkspace)).toBeDefined();
    expect(screen.queryByTestId("hosted-panel")).toBeNull();
  });
});
