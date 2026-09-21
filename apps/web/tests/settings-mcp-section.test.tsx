// @vitest-environment jsdom
/**
 * @file settings mcp section tests
 * @description Locks the MCP settings tab: list load, enable toggle through the
 * full-list replace, and the create flow.
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

const SERVERS: McpServerEntry[] = [
  { command: "npx -y server-a", name: "alpha", enabled: true },
  { command: "node mcp.js", enabled: false },
];

function renderSection() {
  return render(
    <I18nProvider initialLocale="en">
      <McpSection onFlash={() => {}} />
    </I18nProvider>,
  );
}

describe("McpSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads the list and derives display names (explicit name, else whole command)", async () => {
    fetchMock.mockResolvedValue(SERVERS);
    renderSection();
    await waitFor(() => expect(screen.getByText("alpha")).toBeDefined());
    // A command without path separators derives its display name as-is.
    // Name and transport summary render the same string for this fixture.
    expect(screen.getAllByText("node mcp.js").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(getCatalog("en").settings.mcp.disabledBadge)).toBeDefined();
  });

  it("toggling a server saves the full list with the flipped flag", async () => {
    fetchMock.mockResolvedValue(SERVERS);
    saveMock.mockImplementation(async (next) => next);
    renderSection();
    await waitFor(() => expect(screen.getByText("alpha")).toBeDefined());
    fireEvent.click(screen.getByRole("switch", { name: getCatalog("en").settings.mcp.toggleAria.replace("{name}", "alpha") }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const sent = saveMock.mock.calls[0]?.[0] ?? [];
    expect(sent.find((entry) => entry.name === "alpha")?.enabled).toBe(false);
    expect(sent.find((entry) => entry.name === undefined)?.enabled).toBe(false);
  });

  it("the create flow posts a normalized server through the full-list replace", async () => {
    fetchMock.mockResolvedValue([]);
    saveMock.mockImplementation(async (next) => next);
    renderSection();
    await waitFor(() => expect(screen.getByText(getCatalog("en").settings.mcp.empty)).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.mcp.create }));
    fireEvent.change(screen.getByPlaceholderText(getCatalog("en").settings.mcp.namePlaceholder), {
      target: { value: "beta" },
    });
    fireEvent.change(screen.getByPlaceholderText(getCatalog("en").settings.mcp.commandPlaceholder), {
      target: { value: "deno run mcp.ts" },
    });
    fireEvent.change(screen.getByPlaceholderText(getCatalog("en").settings.mcp.argsPlaceholder), {
      target: { value: "--allow-net\n--quiet" },
    });
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.mcp.save }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const sent = saveMock.mock.calls[0]?.[0] ?? [];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      name: "beta",
      command: "deno run mcp.ts",
      args: ["--allow-net", "--quiet"],
      enabled: true,
    });
  });
});
