// @vitest-environment jsdom
/**
 * @file settings field tests
 * @description Locks the labeled form-field wrapper.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Field } from "../src/app/settings/Field.js";

afterEach(cleanup);

describe("Field", () => {
  it("renders its label around the control", () => {
    render(
      <Field label="API token">
        <input aria-label="token value" />
      </Field>,
    );
    const label = screen.getByText("API token").closest("label");
    expect(label).not.toBeNull();
    expect(label?.querySelector("input")).not.toBeNull();
  });
});
