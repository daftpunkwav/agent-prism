// @vitest-environment jsdom
/**
 * @file settings connections section tests
 * @description Locks the connections detail pane: the JSON config editor never
 * outlives its connection selection, and the JSON door cannot empty a group.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { blankConnection, blankModel, type ConnectionGroup } from "../src/app/settings/settingsConnectionModel.js";
import { ConnectionsSection } from "../src/app/settings/ConnectionsSection.js";

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  testProvider: vi.fn(),
}));

function connection(key: string, name: string): ConnectionGroup {
  const group = blankConnection();
  group.key = key;
  group.provider_name = name;
  group.models = [{ ...blankModel(), id: `${key}-model`, model: `${name.toLowerCase()}-model` }];
  return group;
}

/** Builds a fresh props set; mutates selectedKey across rerenders. */
function makeProps() {
  return {
    connections: [connection("a", "Alpha"), connection("b", "Beta")],
    modelCount: 2,
    defaultEndpointId: "a-model",
    selectedKey: "a" as string | null,
    saving: false,
    onSelect: vi.fn(),
    onUpdateConn: vi.fn(),
    onUpdateModel: vi.fn(),
    onSetDefault: vi.fn(),
    onDeleteModel: vi.fn(),
    onDeleteConn: vi.fn(),
    onAddModel: vi.fn(),
    onAddProvider: vi.fn(),
    onSave: vi.fn(),
    onFlash: vi.fn(),
  };
}

function renderSection(props: ReturnType<typeof makeProps>) {
  return render(
    <I18nProvider initialLocale="en">
      <ConnectionsSection {...props} />
    </I18nProvider>,
  );
}

function jsonTextarea(): HTMLTextAreaElement {
  const textarea = document.querySelector("textarea");
  if (textarea === null) throw new Error("JSON textarea not open");
  return textarea;
}

describe("ConnectionsSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the rail and the selected detail pane", () => {
    renderSection(makeProps());
    expect(screen.getByRole("tab", { name: /Alpha/ })).toBeDefined();
    expect(screen.getByRole("tab", { name: /Beta/ })).toBeDefined();
    expect(screen.getByRole("button", { name: getCatalog("en").settings.config.edit })).toBeDefined();
  });

  it("closes the JSON config editor when the selected connection changes", () => {
    const props = makeProps();
    const view = renderSection(props);
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.config.edit }));
    expect(jsonTextarea()).toBeDefined();
    // Same mounted instance, other connection: the draft must not follow.
    view.rerender(
      <I18nProvider initialLocale="en">
        <ConnectionsSection {...props} selectedKey="b" />
      </I18nProvider>,
    );
    expect(screen.queryByRole("button", { name: getCatalog("en").settings.config.apply })).toBeNull();
  });

  it("rejects a JSON apply that would empty the group's model list", () => {
    const props = makeProps();
    renderSection(props);
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.config.edit }));
    fireEvent.change(jsonTextarea(), { target: { value: '{"models": []}' } });
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.config.apply }));
    expect(props.onFlash).toHaveBeenCalledWith(getCatalog("en").settings.config.emptyModels);
    expect(props.onUpdateConn).not.toHaveBeenCalled();
  });

  it("applies valid JSON onto the connection through onUpdateConn", () => {
    const props = makeProps();
    renderSection(props);
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.config.edit }));
    fireEvent.change(jsonTextarea(), {
      target: { value: '{"provider_name": "Renamed", "models": [{"model": "m2"}]}' },
    });
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.config.apply }));
    expect(props.onUpdateConn).toHaveBeenCalledTimes(1);
    const [key, patch] = props.onUpdateConn.mock.calls[0] as unknown as [
      string,
      { provider_name: string; models: Array<{ model: string }> },
    ];
    expect(key).toBe("a");
    expect(patch.provider_name).toBe("Renamed");
    expect(patch.models).toHaveLength(1);
    expect(patch.models[0]?.model).toBe("m2");
  });

  it("gives each JSON row past the current list its own fresh id", () => {
    const props = makeProps();
    renderSection(props);
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.config.edit }));
    fireEvent.change(jsonTextarea(), {
      target: { value: '{"models": [{}, {}, {}]}' },
    });
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.config.apply }));
    expect(props.onUpdateConn).toHaveBeenCalledTimes(1);
    const [, patch] = props.onUpdateConn.mock.calls[0] as unknown as [
      string,
      { models: Array<{ id: string; model: string }> },
    ];
    // Shared fallback ids would collide in the React list key and the
    // update/delete-by-id handlers.
    const ids = patch.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(patch.models[1]?.model).toBe("alpha-model");
    expect(patch.models[2]?.model).toBe("alpha-model");
  });
});
