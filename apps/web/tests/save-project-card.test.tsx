// @vitest-environment jsdom
/**
 * @file save project card tests
 * @description Locks the archive-as-project card: input handoff, save gating, and result coloring.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { SaveProjectCard } from "../src/app/arena/SaveProjectCard.js";

function renderCard(overrides?: {
  savingProject?: boolean;
  saveProjectMsg?: string | null;
  saveProjectOk?: boolean | null;
  canSave?: boolean;
}) {
  const onProjectNameChange = vi.fn();
  const onSave = vi.fn();
  render(
    <I18nProvider initialLocale="en">
      <SaveProjectCard
        projectName=""
        onProjectNameChange={onProjectNameChange}
        savingProject={overrides?.savingProject ?? false}
        saveProjectMsg={overrides?.saveProjectMsg ?? null}
        saveProjectOk={overrides?.saveProjectOk ?? null}
        canSave={overrides?.canSave ?? true}
        onSave={onSave}
      />
    </I18nProvider>,
  );
  return { onProjectNameChange, onSave };
}

afterEach(cleanup);

describe("SaveProjectCard", () => {
  it("hands the typed name to the parent and saves on click", () => {
    const { onProjectNameChange, onSave } = renderCard();
    const input = screen.getByLabelText(getCatalog("en").arena.project.nameAria);
    fireEvent.change(input, { target: { value: "my run" } });
    expect(onProjectNameChange).toHaveBeenCalledWith("my run");
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").arena.project.create }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("disables the create button while unsaved or saving", () => {
    const { onSave } = renderCard({ canSave: false });
    expect((screen.getByRole("button", { name: getCatalog("en").arena.project.create }) as HTMLButtonElement).disabled).toBe(true);
    const { onSave: onSaveSaving } = renderCard({ savingProject: true });
    const saving = screen.getByRole("button", { name: getCatalog("en").arena.action.saving }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    fireEvent.click(saving);
    expect(onSave).not.toHaveBeenCalled();
    expect(onSaveSaving).not.toHaveBeenCalled();
  });

  it("colors the result message by outcome", () => {
    renderCard({ saveProjectMsg: "saved ok", saveProjectOk: true });
    expect(screen.getByText("saved ok").className).toContain("text-success");
    renderCard({ saveProjectMsg: "went wrong", saveProjectOk: false });
    expect(screen.getByText("went wrong").className).toContain("text-destructive");
  });
});
