/**
 * @file Toggle
 * @description The settings row enable switch (role=switch), shared by the
 * skills and MCP sections.
 *
 * Responsibilities:
 * - Render one accessible on/off switch row control
 */

/** Accessible switch row control with the shared settings look. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors " +
        (checked ? "border-primary/60 bg-primary/80" : "border-border bg-muted")
      }
      onClick={() => onChange(!checked)}
    >
      <span
        className={
          "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-background transition-all " +
          (checked ? "left-[1.15rem]" : "left-0.5")
        }
      />
    </button>
  );
}
