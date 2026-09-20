// @vitest-environment jsdom
/**
 * @file builder client shell tests
 * @description Smoke-locks the Builder page container: header, session rail, and catalog bootstrap.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { fetchBuilderCatalog, fetchBuilderSessions } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { BuilderClient } from "../src/app/builder/BuilderClient.js";

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchBuilderCatalog: vi.fn(async () => ({}) as never),
  fetchBuilderSessions: vi.fn(async () => []),
}));

const catalogMock = vi.mocked(fetchBuilderCatalog);
const sessionsMock = vi.mocked(fetchBuilderSessions);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderBuilder() {
  return render(
    <I18nProvider initialLocale="en">
      <BuilderClient />
    </I18nProvider>,
  );
}

describe("BuilderClient shell", () => {
  it("boots the catalog and session list and renders the header", async () => {
    const title = getCatalog("en").builder.title;
    renderBuilder();
    expect((await screen.findAllByText(title)).length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(catalogMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(sessionsMock).toHaveBeenCalledOnce());
    // New-agent affordance is present with no sessions yet.
    expect(screen.getByText(getCatalog("en").builder.newAgent)).toBeDefined();
  });
});
