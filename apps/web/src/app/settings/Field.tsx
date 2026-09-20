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
    <label className="block space-y-2">
      <span className="eyebrow block">{label}</span>
      {children}
    </label>
  );
}
