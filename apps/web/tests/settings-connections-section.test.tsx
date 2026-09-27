// @vitest-environment jsdom
/**
 * @file settings connections section tests
 * @description Locks the connections detail pane: field edits, per-model actions,
 * connection deletion, and the JSON config editor.
 *
 * Responsibilities:
 * - Pin that the JSON editor never outlives its connection selection and cannot
 *   empty a group
 * - Pin the detail form's edits (routing fields, key visibility) and the
 *   per-model test/enable/delete actions
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("edits the routing fields through the detail form", () => {
    const props = makeProps();
    renderSection(props);
    const en = getCatalog("en").settings.connection;

    fireEvent.change(screen.getByDisplayValue("Alpha"), { target: { value: "Alpha renamed" } });
    expect(props.onUpdateConn).toHaveBeenCalledWith("a", { provider_name: "Alpha renamed" });

    // The Request URL label wraps both the URL input and the as-is checkbox, so the
    // input is addressed by its current value.
    const urlInput = screen.getByDisplayValue("https://api.example.com/v1") as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "https://example.test/v1" } });
    expect(props.onUpdateConn).toHaveBeenCalledWith("a", { base_url: "https://example.test/v1" });

    fireEvent.click(screen.getByRole("checkbox", { name: en.fullUrl }));
    expect(props.onUpdateConn).toHaveBeenCalledWith("a", { use_full_url: false });
  });

  it("reveals the stored API key only through the visibility toggle", () => {
    const props = makeProps();
    // A stored key is reported by the mask flag, not by shipping the value to the UI.
    props.connections[0]!.api_key_set = true;
    renderSection(props);
    const en = getCatalog("en").settings.connection;

    const input = screen.getByPlaceholderText(en.keyPlaceholderSaved) as HTMLInputElement;
    // Masked by default: the field type hides whatever it shows.
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: en.showKeyAria }));
    expect((screen.getByPlaceholderText(en.keyPlaceholderSaved) as HTMLInputElement).type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: en.hideKeyAria }));
    expect((screen.getByPlaceholderText(en.keyPlaceholderSaved) as HTMLInputElement).type).toBe("password");
  });

  it("deletes a connection and clears the selection", () => {
    const props = makeProps();
    renderSection(props);
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.connection.deleteGroup }));
    expect(props.onDeleteConn).toHaveBeenCalledWith("a");
    // Deleting the open connection must also drop the selection, or the pane
    // would keep rendering a group that no longer exists.
    expect(props.onSelect).toHaveBeenCalledWith(null);
  });

  it("tests one model with the connection's routing and reports the outcome", async () => {
    const { testProvider } = await import("@agentprism/client");
    const testMock = vi.mocked(testProvider);
    testMock.mockResolvedValue({ ok: true, message: "pong" } as never);
    const props = makeProps();
    props.connections[0]!.api_key = "sk-live-123";
    renderSection(props);
    const en = getCatalog("en").settings.connection;

    fireEvent.click(screen.getAllByRole("button", { name: en.test })[0] as Element);
    await waitFor(() => expect(testMock).toHaveBeenCalledTimes(1));
    const payload = testMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload["model"]).toBe("alpha-model");
    expect(payload["api_key"]).toBe("sk-live-123");
    expect((payload["endpoints"] as Array<Record<string, unknown>>)[0]?.["model"]).toBe("alpha-model");
    await waitFor(() => expect(props.onFlash).toHaveBeenCalled());
    testMock.mockReset();
  });

  it("refuses to test a model without a model id", async () => {
    const { testProvider } = await import("@agentprism/client");
    const testMock = vi.mocked(testProvider);
    const props = makeProps();
    props.connections[0]!.api_key = "sk-live-123";
    props.connections[0]!.models[0]!.model = "  ";
    renderSection(props);
    fireEvent.click(screen.getAllByRole("button", { name: getCatalog("en").settings.connection.test })[0] as Element);
    await waitFor(() => expect(props.onFlash).toHaveBeenCalledWith(expect.stringContaining("model id")));
    expect(testMock).not.toHaveBeenCalled();
  });

  it("toggles a model's enabled flag and deletes a model", () => {
    const props = makeProps();
    renderSection(props);
    const modelCopy = getCatalog("en").settings.model;
    fireEvent.click(screen.getByRole("switch", { name: modelCopy.enableAria }));
    expect(props.onUpdateModel).toHaveBeenCalledWith("a", "a-model", { enabled: false });
    // The per-model delete is deliberately disabled while it is the group's
    // last model (a group with zero models has no routing to save).
    expect((screen.getByRole("button", { name: modelCopy.deleteAria }) as HTMLButtonElement).disabled).toBe(true);
    expect(props.onDeleteModel).not.toHaveBeenCalled();
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
