/**
 * @file MainTabButton
 * @description View-switching tab button at the top of the Arena stage.
 *
 * Responsibilities:
 * - Switch the stage's active view
 */

"use client";

/** View-switching tab button at the top of the Arena stage. */
export function MainTabButton({
  active,
  onClick,
  icon,
  label,
  disabled,
  disabledReason,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  badge?: number | string | null;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-disabled={disabled}
      onClick={onClick}
      disabled={disabled}
      className="main-tab"
      title={disabled ? disabledReason : undefined}
      data-active={active}
    >
      {icon}
      {label}
      {badge != null && <span className="main-tab-badge">{badge}</span>}
    </button>
  );
}
