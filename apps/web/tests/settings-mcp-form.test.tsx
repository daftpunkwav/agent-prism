// @vitest-environment jsdom
/**
 * @file settings mcp form tests
 * @description Locks the inline MCP server form: draft prefill, field validation,
 * request payload construction, and how a saved server replaces its row.
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
  { command: "npx -y server-a", name: "alpha", enabled: true, env: { PORT: "8080" }, timeoutMs: 5000, tools: ["read"] },
  { command: "node mcp.js", enabled: false },
];

const mcp = getCatalog("en").settings.mcp;

function renderSection(onFlash: (message: string) => void = () => {}) {
  return render(
    <I18nProvider initialLocale="en">
      <McpSection onFlash={onFlash} />
    </I18nProvider>,
  );
}

async function openCreate(): Promise<void> {
  await waitFor(() => expect(screen.getByRole("button", { name: mcp.create })).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: mcp.create }));
}

function fill(field: "command" | "args" | "env" | "timeout" | "tools", value: string): void {
  const placeholders = {
    command: mcp.commandPlaceholder,
    args: mcp.argsPlaceholder,
    env: mcp.envPlaceholder,
    timeout: mcp.timeoutPlaceholder,
    tools: mcp.toolsPlaceholder,
  };
  fireEvent.change(screen.getByPlaceholderText(placeholders[field]), { target: { value } });
}

describe("MCP server form", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("refuses to save without a command", async () => {
    fetchMock.mockResolvedValue([]);
    renderSection();
    await openCreate();
    fireEvent.click(screen.getByRole("button", { name: mcp.save }));
    await waitFor(() => expect(screen.getByText(mcp.errorCommand)).toBeDefined());
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("rejects an environment block that is not a JSON object", async () => {
    fetchMock.mockResolvedValue([]);
    renderSection();
    await openCreate();
    fill("command", "node mcp.js");
    // An array and a bare string both parse as JSON but are not a key/value object.
    fill("env", "[1,2]");
    fireEvent.click(screen.getByRole("button", { name: mcp.save }));
    await waitFor(() => expect(screen.getByText(mcp.errorEnv)).toBeDefined());
    fill("env", "\"text\"");
    fireEvent.click(screen.getByRole("button", { name: mcp.save }));
    await waitFor(() => expect(screen.getByText(mcp.errorEnv)).toBeDefined());
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("sends environment values as strings and drops empty optional fields", async () => {
    fetchMock.mockResolvedValue([]);
    saveMock.mockImplementation(async (next) => next);
    renderSection();
    await openCreate();
    fill("command", "  node mcp.js  ");
    fill("env", "{\"PORT\": 8080, \"DEBUG\": true}");
    fireEvent.click(screen.getByRole("button", { name: mcp.save }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const sent = saveMock.mock.calls[0]?.[0] ?? [];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ command: "node mcp.js", env: { PORT: "8080", DEBUG: "true" }, enabled: true });
    // Optional fields left blank must not appear at all.
    expect(sent[0]).not.toHaveProperty("name");
    expect(sent[0]).not.toHaveProperty("args");
    expect(sent[0]).not.toHaveProperty("timeoutMs");
    expect(sent[0]).not.toHaveProperty("tools");
  });

  it("trims argument lines, drops blanks, and keeps only digits in the timeout", async () => {
    fetchMock.mockResolvedValue([]);
    saveMock.mockImplementation(async (next) => next);
    renderSection();
    await openCreate();
    fill("command", "node mcp.js");
    fill("args", " --allow-net \n\n  --quiet  \n");
    fill("timeout", "30s000");
    fill("tools", " read, grep ,,");
    expect(screen.getByPlaceholderText(mcp.timeoutPlaceholder)).toHaveProperty("value", "30000");
    fireEvent.click(screen.getByRole("button", { name: mcp.save }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const sent = saveMock.mock.calls[0]?.[0] ?? [];
    expect(sent[0]).toMatchObject({
      args: ["--allow-net", "--quiet"],
      timeoutMs: 30000,
      tools: ["read", "grep"],
    });
  });

  it("prefills the edit form and replaces the entry that shares its identity", async () => {
    fetchMock.mockResolvedValue(SERVERS);
    saveMock.mockImplementation(async (next) => next);
    renderSection();
    // The nameless entry is identified by its command.
    const rowName = "node mcp.js";
    await waitFor(() => expect(screen.getByRole("button", { name: mcp.editAria.replace("{name}", rowName) })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: mcp.editAria.replace("{name}", rowName) }));
    expect(screen.getByText(mcp.editTitle.replace("{name}", rowName))).toBeDefined();
    expect(screen.getByPlaceholderText(mcp.commandPlaceholder)).toHaveProperty("value", "node mcp.js");
    expect(screen.getByRole("switch", { name: mcp.enabledAria }).getAttribute("aria-checked")).toBe("false");
    fill("command", "node other.js");
    fireEvent.click(screen.getByRole("button", { name: mcp.save }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const sent = saveMock.mock.calls[0]?.[0] ?? [];
    expect(sent).toHaveLength(SERVERS.length);
    expect(sent.find((entry) => entry.command === "node other.js")?.enabled).toBe(false);
    expect(sent.find((entry) => entry.name === "alpha")).toEqual(SERVERS[0]);
  });

  it("carries the stored environment, timeout, and tools into the edit draft", async () => {
    fetchMock.mockResolvedValue(SERVERS);
    renderSection();
    await waitFor(() => expect(screen.getByText("alpha")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: mcp.editAria.replace("{name}", "alpha") }));
    expect(screen.getByPlaceholderText(mcp.envPlaceholder)).toHaveProperty("value", JSON.stringify({ PORT: "8080" }, null, 2));
    expect(screen.getByPlaceholderText(mcp.timeoutPlaceholder)).toHaveProperty("value", "5000");
    expect(screen.getByPlaceholderText(mcp.toolsPlaceholder)).toHaveProperty("value", "read");
  });

  it("closes the form without saving when cancelled", async () => {
    fetchMock.mockResolvedValue([]);
    renderSection();
    await openCreate();
    // The header close button and the footer button both cancel.
    fireEvent.click(screen.getAllByRole("button", { name: mcp.cancel })[0]!);
    expect(screen.queryByPlaceholderText(mcp.commandPlaceholder)).toBeNull();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("reports a failed save through the flash callback and keeps the draft", async () => {
    fetchMock.mockResolvedValue([]);
    saveMock.mockRejectedValue(new Error("disk full"));
    const onFlash = vi.fn();
    renderSection(onFlash);
    await openCreate();
    fill("command", "node mcp.js");
    fireEvent.click(screen.getByRole("button", { name: mcp.save }));
    await waitFor(() => expect(onFlash).toHaveBeenCalledWith("disk full"));
    expect(screen.getByText(mcp.errorSave)).toBeDefined();
    expect(screen.getByPlaceholderText(mcp.commandPlaceholder)).toHaveProperty("value", "node mcp.js");
  });

  it("closes the form and reloads the list after a successful save", async () => {
    saveMock.mockImplementation(async (next) => next);
    fetchMock.mockResolvedValue([{ command: "node mcp.js", enabled: true }]);
    renderSection();
    await openCreate();
    fill("command", "node mcp.js");
    fireEvent.click(screen.getByRole("button", { name: mcp.save }));
    // The section re-reads the server list once the form reports the save.
    await waitFor(() => expect(screen.queryByPlaceholderText(mcp.commandPlaceholder)).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: mcp.editAria.replace("{name}", "node mcp.js") })).toBeDefined();
  });
});
