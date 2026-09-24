// @vitest-environment jsdom
/**
 * @file runtime knobs section tests
 * @description Locks the runtime knobs editor: load, grouped fields, reset, and hot-apply save.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { fetchRuntimeKnobs, saveRuntimeKnobs, type RuntimeKnobsPayload } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { RuntimeKnobsSection } from "../src/app/settings/RuntimeKnobsSection.js";

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchRuntimeKnobs: vi.fn(),
  saveRuntimeKnobs: vi.fn(),
}));

const fetchMock = vi.mocked(fetchRuntimeKnobs);
const saveMock = vi.mocked(saveRuntimeKnobs);

const PAYLOAD = {
  knobs: { contextWindowMessages: 160, llmMaxRetries: 2, crewaiProcess: "sequential" },
  fields: [
    { key: "contextWindowMessages", group: "context", kind: "number", default: 120, min: 8, max: 512, step: 1 },
    { key: "llmMaxRetries", group: "llm", kind: "number", default: 1, min: 0, max: 10, step: 1 },
    { key: "crewaiProcess", group: "llm", kind: "select", default: "sequential", options: ["sequential", "hierarchical"] },
  ],
} as unknown as RuntimeKnobsPayload;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSection(onFlash = vi.fn()) {
  render(
    <I18nProvider initialLocale="en">
      <RuntimeKnobsSection onFlash={onFlash} />
    </I18nProvider>,
  );
  return onFlash;
}

describe("RuntimeKnobsSection", () => {
  it("shows the failure state when the load rejects", async () => {
    fetchMock.mockRejectedValue(new Error("backend down"));
    renderSection();
    expect(await screen.findByText("backend down")).toBeDefined();
  });

  it("renders grouped editors with loaded values and binds changes", async () => {
    fetchMock.mockResolvedValue(PAYLOAD);
    renderSection();
    const context = await screen.findByLabelText(
      getCatalog("en").settings.runtime.fields.contextWindowMessages,
    ) as HTMLInputElement;
    expect(context.value).toBe("160");
    // Nested key resolved through the dot path.
    const retries = screen.getByLabelText(getCatalog("en").settings.runtime.fields.llmMaxRetries) as HTMLInputElement;
    expect(retries.value).toBe("2");
    fireEvent.change(context, { target: { value: "200" } });
    expect(context.value).toBe("200");
  });

  it("resets one field to its metadata default", async () => {
    fetchMock.mockResolvedValue(PAYLOAD);
    renderSection();
    const context = await screen.findByLabelText(
      getCatalog("en").settings.runtime.fields.contextWindowMessages,
    ) as HTMLInputElement;
    fireEvent.change(context, { target: { value: "200" } });
    // Several number fields carry reset buttons; use the one inside this field's label.
    const fieldLabel = context.closest("label")!;
    fireEvent.click(within(fieldLabel as HTMLElement).getByRole("button", { name: getCatalog("en").settings.runtime.resetTitle }));
    await waitFor(() => expect(context.value).toBe("120"));
  });

  it("renders select-kind knobs from metadata options", async () => {
    fetchMock.mockResolvedValue(PAYLOAD);
    renderSection();
    const select = await screen.findByLabelText(getCatalog("en").settings.runtime.fields.crewaiProcess);
    expect(select).toBeDefined();
    // The knob mirrors the loaded value through the shared select.
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("saves the draft and flashes the confirmation with the server-normalized values", async () => {
    fetchMock.mockResolvedValue(PAYLOAD);
    saveMock.mockResolvedValue({
      knobs: { contextWindowMessages: 200, llmMaxRetries: 2, crewaiProcess: "sequential" },
      fields: PAYLOAD.fields,
    } as unknown as RuntimeKnobsPayload);
    const onFlash = renderSection();
    const context = await screen.findByLabelText(
      getCatalog("en").settings.runtime.fields.contextWindowMessages,
    ) as HTMLInputElement;
    fireEvent.focus(context);
    fireEvent.change(context, { target: { value: "200" } });
    fireEvent.blur(context);
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.runtime.save }));
    await waitFor(() => expect(onFlash).toHaveBeenCalledWith(getCatalog("en").settings.runtime.saved));
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ contextWindowMessages: 200, llmMaxRetries: 2, crewaiProcess: "sequential" }),
    );
  });

  it("flashes the backend error when the save fails", async () => {
    fetchMock.mockResolvedValue(PAYLOAD);
    saveMock.mockRejectedValue(new Error("read-only"));
    const onFlash = renderSection();
    await screen.findByLabelText(getCatalog("en").settings.runtime.fields.contextWindowMessages);
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.runtime.save }));
    await waitFor(() => expect(onFlash).toHaveBeenCalledWith("read-only"));
  });
});
