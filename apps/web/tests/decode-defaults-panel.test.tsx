// @vitest-environment jsdom
/**
 * @file decode defaults panel tests
 * @description Locks the arena decode panel: provider load, slider commits, and failure states.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fetchProvider, saveProvider, type ProviderConfig } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { DecodeDefaultsPanel } from "../src/app/arena/DecodeDefaultsPanel.js";

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchProvider: vi.fn(),
  saveProvider: vi.fn(),
}));

const fetchMock = vi.mocked(fetchProvider);
const saveMock = vi.mocked(saveProvider);

const CONFIG = {
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
} as unknown as ProviderConfig;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPanel() {
  render(
    <I18nProvider initialLocale="en">
      <DecodeDefaultsPanel columnCount={3} description="Control the decoding defaults." />
    </I18nProvider>,
  );
}

describe("DecodeDefaultsPanel", () => {
  it("shows the load failure with detail when the provider fetch rejects", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    renderPanel();
    expect(
      await screen.findByText(getCatalog("en").arena.decode.loadFailedDetail.replace("{detail}", "offline")),
    ).toBeDefined();
    expect(screen.getByText(getCatalog("en").arena.decode.loadFailedHint)).toBeDefined();
  });

  it("renders the endpoint summary and slider values from the loaded config", async () => {
    fetchMock.mockResolvedValue(CONFIG);
    renderPanel();
    expect(await screen.findByText("glm-5.3")).toBeDefined();
    expect(screen.getByText("z.ai")).toBeDefined();
    expect((screen.getByLabelText("Temperature") as HTMLInputElement).value).toBe("0.5");
    expect((screen.getByLabelText("Max Tokens") as HTMLInputElement).value).toBe("8192");
    expect(screen.getByText("Control the decoding defaults.")).toBeDefined();
  });

  it("saves on slider release and refreshes the snapshot from the response", async () => {
    fetchMock.mockResolvedValue(CONFIG);
    const saved = { ...CONFIG, temperature: 0.8 };
    saveMock.mockResolvedValue(saved);
    renderPanel();
    await screen.findByText("glm-5.3");
    const temperature = screen.getByLabelText("Temperature") as HTMLInputElement;
    fireEvent.change(temperature, { target: { value: "0.8" } });
    fireEvent.keyUp(temperature);
    await waitFor(() => expect(saveMock).toHaveBeenCalledOnce());
    // The saved value round-trips into the slider.
    await waitFor(() => expect((screen.getByLabelText("Temperature") as HTMLInputElement).value).toBe("0.8"));
  });

  it("surfaces save failures in the header", async () => {
    fetchMock.mockResolvedValue(CONFIG);
    saveMock.mockRejectedValue(new Error("locked"));
    renderPanel();
    await screen.findByText("glm-5.3");
    const temperature = screen.getByLabelText("Temperature") as HTMLInputElement;
    fireEvent.change(temperature, { target: { value: "0.8" } });
    fireEvent.keyUp(temperature);
    expect(await screen.findByText("locked")).toBeDefined();
  });

  it("expands the token estimate breakdown", async () => {
    fetchMock.mockResolvedValue(CONFIG);
    renderPanel();
    const toggle = await screen.findByRole("button", { name: new RegExp(getCatalog("en").arena.decode.estimateTitle) });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(getCatalog("en").arena.decode.estimateMethod)).toBeDefined();
  });
});
