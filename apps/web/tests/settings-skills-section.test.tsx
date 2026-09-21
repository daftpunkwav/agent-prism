// @vitest-environment jsdom
/**
 * @file settings skills section tests
 * @description Locks the skill settings tab: catalog load, search filter,
 * enable toggle, and the create flow.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createSkill, deleteSkill, fetchSkills, setSkillEnabled, updateSkill, type SkillEntry } from "@agentprism/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { SkillsSection } from "../src/app/settings/SkillsSection.js";

vi.mock("@agentprism/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentprism/client")>()),
  fetchSkills: vi.fn(),
  createSkill: vi.fn(),
  setSkillEnabled: vi.fn(),
  deleteSkill: vi.fn(),
  updateSkill: vi.fn(),
}));

const fetchMock = vi.mocked(fetchSkills);
const toggleMock = vi.mocked(setSkillEnabled);
const createMock = vi.mocked(createSkill);
const deleteMock = vi.mocked(deleteSkill);
const updateMock = vi.mocked(updateSkill);

const CATALOG: SkillEntry[] = [
  { name: "commit", description: "Repo commit conventions", source: "bundled", enabled: true },
  { name: "my-notes", description: "Write better notes", source: "user", enabled: false },
];

function renderSection() {
  return render(
    <I18nProvider initialLocale="en">
      <SkillsSection onFlash={() => {}} />
    </I18nProvider>,
  );
}

describe("SkillsSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads the catalog and renders rows with source badges", async () => {
    fetchMock.mockResolvedValue(CATALOG);
    renderSection();
    await waitFor(() => expect(screen.getByText("commit")).toBeDefined());
    expect(screen.getByText("my-notes")).toBeDefined();
    expect(screen.getByText("bundled")).toBeDefined();
    expect(screen.getByText("user")).toBeDefined();
  });

  it("filters rows by search text", async () => {
    fetchMock.mockResolvedValue(CATALOG);
    renderSection();
    await waitFor(() => expect(screen.getByText("commit")).toBeDefined());
    fireEvent.change(screen.getByPlaceholderText(getCatalog("en").settings.skills.searchPlaceholder), {
      target: { value: "notes" },
    });
    expect(screen.queryByText("commit")).toBeNull();
    expect(screen.getByText("my-notes")).toBeDefined();
  });

  it("toggling a skill calls setSkillEnabled with the flipped flag", async () => {
    fetchMock.mockResolvedValue(CATALOG);
    toggleMock.mockResolvedValue(undefined);
    renderSection();
    await waitFor(() => expect(screen.getByText("commit")).toBeDefined());
    fireEvent.click(screen.getByRole("switch", { name: getCatalog("en").settings.skills.toggleAria.replace("{name}", "commit") }));
    await waitFor(() => expect(toggleMock).toHaveBeenCalledWith("commit", false));
  });

  it("the create flow posts through createSkill and reloads", async () => {
    fetchMock.mockResolvedValue(CATALOG);
    createMock.mockResolvedValue(undefined);
    renderSection();
    await waitFor(() => expect(screen.getByText("commit")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.skills.create }));
    fireEvent.change(screen.getByPlaceholderText(getCatalog("en").settings.skills.namePlaceholder), {
      target: { value: "fresh-skill" },
    });
    fireEvent.change(screen.getByPlaceholderText(getCatalog("en").settings.skills.descriptionPlaceholder), {
      target: { value: "does something" },
    });
    fireEvent.change(screen.getByPlaceholderText(getCatalog("en").settings.skills.bodyPlaceholder), {
      target: { value: "1. do it" },
    });
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.skills.save }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ name: "fresh-skill", description: "does something", body: "1. do it" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("deleting a user skill calls deleteSkill and reloads", async () => {
    fetchMock.mockResolvedValue(CATALOG);
    deleteMock.mockResolvedValue(undefined);
    window.confirm = () => true;
    renderSection();
    await waitFor(() => expect(screen.getByText("my-notes")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.skills.deleteAria.replace("{name}", "my-notes") }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("my-notes"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("editing a user skill posts the patch through updateSkill and reloads", async () => {
    fetchMock.mockResolvedValue(CATALOG);
    updateMock.mockResolvedValue(undefined);
    renderSection();
    await waitFor(() => expect(screen.getByText("my-notes")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.skills.editAria.replace("{name}", "my-notes") }));
    await waitFor(() => expect(screen.getByPlaceholderText(getCatalog("en").settings.skills.descriptionPlaceholder)).toBeDefined());
    fireEvent.change(screen.getByPlaceholderText(getCatalog("en").settings.skills.descriptionPlaceholder), {
      target: { value: "updated description" },
    });
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").settings.skills.save }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("my-notes", { description: "updated description" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
