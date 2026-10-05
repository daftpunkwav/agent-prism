/**
 * @file Field
 * @description Small labeled form-field wrapper for the settings pages.
 *
 * Responsibilities:
 * - Render a label around a form control
 */

/** Labeled form-field wrapper. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // children renders the associated form control, so this is a valid implicit label.
    // biome-ignore lint/a11y/noLabelWithoutControl: control arrives via children (implicit labeling)
    <label className="block space-y-2">
      <span className="eyebrow block">{label}</span>
      {children}
    </label>
  );
}
