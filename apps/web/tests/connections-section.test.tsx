// @vitest-environment jsdom
/**
 * @file connections section tests
 * @description Locks the provider settings section: rail selection, field/model handoff, JSON apply, test guard.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import type { ConnectionGroup, ModelSlot } from "../src/app/settings/settingsConnectionModel.js";
import { ConnectionsSection } from "../src/app/settings/ConnectionsSection.js";

function slot(overrides?: Partial<ModelSlot>): ModelSlot {
  return {
    id: "ep-1",
    label: "Main",
    model: "glm-5.3",
    thinking_level: "off",
    thinking_capable: false,
    context_window: 128000,
    max_input_tokens: 120000,
    max_output_tokens: 32000,
    image_input: false,
    video_input: false,
    enabled: true,
    ...overrides,
  } as ModelSlot;
}

function conn(key: string, overrides?: Partial<ConnectionGroup>): ConnectionGroup {
  return {
    key,
    provider_name: key === "conn-1" ? "z.ai" : "MiniMax",
    base_url: "https://api.example.com/v1",
    api_key: "sk-1",
    api_key_set: true,
    use_full_url: true,
    api_format: "openai_chat",
    auth_field: "Authorization",
    website_url: "",
    models: [slot()],
    ...overrides,
  } as ConnectionGroup;
}

function baseHandlers() {
  return {
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

function renderSection(connections: ConnectionGroup[], handlers = baseHandlers(), selectedKey: string | null = "conn-1") {
  render(
    <I18nProvider initialLocale="en">
      <ConnectionsSection
        connections={connections}
        modelCount={connections.reduce((n, c) => n + c.models.length, 0)}
        defaultEndpointId="ep-1"
        selectedKey={selectedKey}
        saving={false}
        {...handlers}
      />
    </I18nProvider>,
  );
  return handlers;
}

const en = () => getCatalog("en").settings;

afterEach(cleanup);

describe("ConnectionsSection", () => {
  it("shows the empty placeholder without a selection", () => {
    renderSection([conn("conn-1")], baseHandlers(), null);
    expect(screen.getByText(en().rail.empty)).toBeDefined();
  });

  it("renders the rail with status dots and switches the detail pane", () => {
    const handlers = renderSection([conn("conn-1"), conn("conn-2", { models: [slot({ id: "ep-2" })] })], baseHandlers(), null);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    fireEvent.click(tabs[1]!);
    expect(handlers.onSelect).toHaveBeenCalledWith("conn-2");
  });

  it("hands connection field edits to the parent", () => {
    const handlers = renderSection([conn("conn-1")]);
    const provider = screen.getByLabelText(en().connection.provider) as HTMLInputElement;
    expect(provider.value).toBe("z.ai");
    fireEvent.change(provider, { target: { value: "zhipu" } });
    expect(handlers.onUpdateConn).toHaveBeenCalledWith("conn-1", { provider_name: "zhipu" });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-2" } });
    expect(handlers.onUpdateConn).toHaveBeenCalledWith("conn-1", { api_key: "sk-2" });
  });

  it("toggles a model's enabled switch and guards the test button without a model id", async () => {
    const handlers = renderSection([conn("conn-1", { models: [slot({ model: "" })] })]);
    fireEvent.click(screen.getByRole("switch", { name: en().model.enableAria }));
    expect(handlers.onUpdateModel).toHaveBeenCalledWith("conn-1", "ep-1", { enabled: false });

    fireEvent.click(screen.getByRole("button", { name: en().connection.test }));
    await waitFor(() => expect(handlers.onFlash).toHaveBeenCalledWith(en().toast.needModelIdBeforeTest));
  });

  it("applies valid JSON onto the connection and rejects invalid JSON", () => {
    const handlers = renderSection([conn("conn-1")]);
    fireEvent.click(screen.getByRole("button", { name: en().config.edit }));
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.value).toContain("z.ai");
    fireEvent.change(textarea, {
      target: { value: JSON.stringify({ provider_name: "zhipu", models: [{ label: "Fallback", model: "glm-4.7" }] }) },
    });
    fireEvent.click(screen.getByRole("button", { name: en().config.apply }));
    expect(handlers.onUpdateConn).toHaveBeenCalledWith(
      "conn-1",
      expect.objectContaining({ provider_name: "zhipu" }),
    );
    expect(handlers.onFlash).toHaveBeenCalledWith(en().config.applied);

    fireEvent.click(screen.getByRole("button", { name: en().config.edit }));
    fireEvent.change(document.querySelector("textarea") as HTMLTextAreaElement, { target: { value: "{ nope" } });
    fireEvent.click(screen.getByRole("button", { name: en().config.apply }));
    expect(handlers.onFlash).toHaveBeenLastCalledWith(en().config.invalidJson);
  });

  it("offers add-provider and add-model actions", () => {
    const handlers = renderSection([conn("conn-1")]);
    fireEvent.click(screen.getByRole("button", { name: en().rail.add }));
    expect(handlers.onAddProvider).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: en().connection.addModel }));
    expect(handlers.onAddModel).toHaveBeenCalledWith("conn-1");
  });
});
