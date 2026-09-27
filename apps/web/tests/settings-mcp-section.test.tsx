// @vitest-environment jsdom
/**
 * @file settings mcp section tests
 * @description Locks the MCP settings tab list surface: load and display names,
 * the search filter, the count, and the enable/delete rows.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fetchMcpServers, saveMcpServers, type McpServerEntry } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { McpSection } from "../src/app/settings/McpSection.js";

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchMcpServers: vi.fn(),
  saveMcpServers: vi.fn(),
}));

const fetchMock = vi.mocked(fetchMcpServers);
const saveMock = vi.mocked(saveMcpServers);

const mcp = getCatalog("en").settings.mcp;

const SERVERS: McpServerEntry[] = [
  { command: "npx -y server-a", name: "alpha", enabled: true },
  { command: "node mcp.js", enabled: false },
  { command: "C:\\tools\\browser.cmd", enabled: true, args: ["--headless"] },
];

function renderSection(onFlash: (message: string) => void = () => {}) {
  return render(
    <I18nProvider initialLocale="en">
      <McpSection onFlash={onFlash} />
    </I18nProvider>,
  );
}

async function loaded(onFlash?: (message: string) => void): Promise<void> {
  renderSection(onFlash);
  await waitFor(() => expect(screen.getByText("alpha")).toBeDefined());
}

describe("McpSection list", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("derives a display name per row and marks the disabled ones", async () => {
    fetchMock.mockResolvedValue(SERVERS);
    await loaded();
    // Explicit name wins; otherwise the command basename, whichever separator the path uses.
    // The row shows the command as both its display name and its transport summary.
    expect(screen.getAllByText("node mcp.js").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("browser.cmd")).toBeDefined();
    expect(screen.getByText(mcp.disabledBadge)).toBeDefined();
    expect(screen.getByText(mcp.count.replace("{count}", "3"))).toBeDefined();
  });

  it("filters the list by name, command, and basename", async () => {
    fetchMock.mockResolvedValue(SERVERS);
    await loaded();
    fireEvent.change(screen.getByPlaceholderText(mcp.searchPlaceholder), { target: { value: "browser" } });
    expect(screen.queryByText("alpha")).toBeNull();
    expect(screen.getByText("browser.cmd")).toBeDefined();
    // Case-insensitive, and the raw command matches too.
    fireEvent.change(screen.getByPlaceholderText(mcp.searchPlaceholder), { target: { value: "NPX -Y" } });
    expect(screen.getByText("alpha")).toBeDefined();
    expect(screen.queryByText("browser.cmd")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(mcp.searchPlaceholder), { target: { value: "nothing-here" } });
    expect(screen.getByText(mcp.empty)).toBeDefined();
  });

  it("toggling a server saves the full list with the flipped flag", async () => {
    fetchMock.mockResolvedValue(SERVERS);
    saveMock.mockImplementation(async (next) => next);
    await loaded();
    fireEvent.click(screen.getByRole("switch", { name: mcp.toggleAria.replace("{name}", "alpha") }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const sent = saveMock.mock.calls[0]?.[0] ?? [];
    expect(sent).toHaveLength(SERVERS.length);
    expect(sent.find((entry) => entry.name === "alpha")?.enabled).toBe(false);
    // Every other entry is carried over untouched.
    expect(sent.find((entry) => entry.command === "C:\\tools\\browser.cmd")).toEqual(SERVERS[2]);
  });

  it("deletes a server once the confirmation is accepted", async () => {
    fetchMock.mockResolvedValue(SERVERS);
    saveMock.mockImplementation(async (next) => next);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: mcp.deleteAria.replace("{name}", "alpha") }));
    expect(confirm).toHaveBeenCalledWith(mcp.deleteConfirm.replace("{name}", "alpha"));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const sent = saveMock.mock.calls[0]?.[0] ?? [];
    expect(sent.map((entry) => entry.command)).toEqual(["node mcp.js", "C:\\tools\\browser.cmd"]);
  });

  it("keeps the list untouched when the delete confirmation is dismissed", async () => {
    fetchMock.mockResolvedValue(SERVERS);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: mcp.deleteAria.replace("{name}", "alpha") }));
    expect(saveMock).not.toHaveBeenCalled();
    expect(screen.getByText("alpha")).toBeDefined();
  });

  it("flashes the server message when a list replace fails", async () => {
    fetchMock.mockResolvedValue(SERVERS);
    saveMock.mockRejectedValue(new Error("read-only config"));
    const onFlash = vi.fn();
    await loaded(onFlash);
    fireEvent.click(screen.getByRole("switch", { name: mcp.toggleAria.replace("{name}", "alpha") }));
    await waitFor(() => expect(onFlash).toHaveBeenCalledWith("read-only config"));
    // The flag is only flipped through the returned list, so the row keeps its state.
    expect(screen.getByRole("switch", { name: mcp.toggleAria.replace("{name}", "alpha") }).getAttribute("aria-checked")).toBe("true");
  });

  it("reports a failed initial load instead of an empty list", async () => {
    fetchMock.mockRejectedValue(new Error("server down"));
    renderSection();
    await waitFor(() => expect(screen.getByText("server down")).toBeDefined());
    expect(screen.getByText(mcp.empty)).toBeDefined();
  });

  it("opens the create form with empty fields", async () => {
    fetchMock.mockResolvedValue([]);
    renderSection();
    await waitFor(() => expect(screen.getByText(mcp.empty)).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: mcp.create }));
    expect(screen.getByText(mcp.createTitle)).toBeDefined();
    expect(screen.getByPlaceholderText(mcp.commandPlaceholder)).toHaveProperty("value", "");
    expect(screen.getByRole("switch", { name: mcp.enabledAria }).getAttribute("aria-checked")).toBe("true");
  });
});
