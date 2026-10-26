/**
 * @file SessionRow
 * @description One row of the Builder session list: the switch affordance, the
 *              inline rename editor, and the run-state controls.
 *
 * Responsibilities:
 * - Render one session entry of the session list
 * - Render the inline rename editor without nesting interactive elements
 *
 * Presentation only: the row owns no state; every mutation is delegated through
 * its props.
 */

"use client";

import { Bot, Check, Pencil, Square, Trash2, X } from "lucide-react";
import type { BuilderSessionView } from "@agentprism/client";
import { useT } from "@/i18n/useT";

export interface SessionRowProps {
  session: BuilderSessionView;
  active: boolean;
  chatBusy: boolean;
  renaming: boolean;
  renameDraft: string;
  onSwitch: (id: string) => void;
  onAbort: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDraftChange: (value: string) => void;
  onStartRename: () => void;
  onFinishRename: () => void;
}

/** Run-state badge at the end of a row: running/idle plus the turn count. */
function SessionMeta({ session }: { session: BuilderSessionView }) {
  const t = useT();
  return (
    <span className="builder-session-meta">
      {session.running ? t("builder.running") : t("builder.idle")} · {session.turn_count}
    </span>
  );
}

/** The inline rename editor. Rendered as a non-interactive div (not a button):
 * HTML forbids <input>/<button> inside <button>, and nesting the editor inside
 * the row's own button broke hydration. */
function SessionRenameEditor({
  session,
  renameDraft,
  onRename,
  onDraftChange,
  onFinishRename,
}: {
  session: BuilderSessionView;
  renameDraft: string;
  onRename: (id: string, name: string) => void;
  onDraftChange: (value: string) => void;
  onFinishRename: () => void;
}) {
  const t = useT();
  return (
    <div className="builder-session-main builder-session-renaming">
      <Bot size={13} />
      <span className="builder-session-rename">
        {/* Inline rename must take focus on mount: the user just clicked rename. */}
        {/* biome-ignore lint/a11y/noAutofocus: focus-on-mount is the rename affordance */}
        <input
          autoFocus
          className="builder-rename-input"
          value={renameDraft}
          maxLength={60}
          aria-label={t("builder.renameAria")}
          onChange={(e) => { onDraftChange(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRename(session.id, renameDraft);
            if (e.key === "Escape") onFinishRename();
          }}
        />
        <button
          type="button"
          className="builder-session-delete"
          aria-label={t("builder.renameConfirm")}
          onClick={() => onRename(session.id, renameDraft)}
        >
          <Check size={12} />
        </button>
        <button
          type="button"
          className="builder-session-delete"
          aria-label={t("builder.renameCancel")}
          onClick={() => { onFinishRename(); }}
        >
          <X size={12} />
        </button>
      </span>
      <SessionMeta session={session} />
    </div>
  );
}

/** Run-state controls at the end of a session row: stop while running,
 * rename + delete otherwise. */
function SessionRowControls({
  session,
  renaming,
  onAbort,
  onDelete,
  onStartRename,
}: {
  session: BuilderSessionView;
  renaming: boolean;
  onAbort: (id: string) => void;
  onDelete: (id: string) => void;
  onStartRename: () => void;
}) {
  const t = useT();
  return session.running ? (
    <button
      type="button"
      className="builder-session-delete"
      aria-label={t("builder.stop")}
      title={t("builder.stop")}
      onClick={() => onAbort(session.id)}
    >
      <Square size={12} />
    </button>
  ) : (
    <>
    {!renaming && (
    <button
      type="button"
      className="builder-session-delete"
      aria-label={t("builder.renameAria")}
      onClick={onStartRename}
    >
      <Pencil size={12} />
    </button>
    )}
    <button
      type="button"
      className="builder-session-delete"
      aria-label={t("builder.delete")}
      onClick={() => onDelete(session.id)}
    >
      <Trash2 size={12} />
    </button>
    </>
  );
}

/** One row in the session list: the switch affordance, the inline rename
 * editor, and the run/delete controls. */
export function SessionRow({
  session,
  active,
  chatBusy,
  renaming,
  renameDraft,
  onSwitch,
  onAbort,
  onDelete,
  onRename,
  onDraftChange,
  onStartRename,
  onFinishRename,
}: SessionRowProps) {
  const t = useT();
  return (
    <div className="builder-session" data-active={active} data-running={session.running}>
      {renaming ? (
        <SessionRenameEditor
          session={session}
          renameDraft={renameDraft}
          onRename={onRename}
          onDraftChange={onDraftChange}
          onFinishRename={onFinishRename}
        />
      ) : (
        <button
          type="button"
          className="builder-session-main"
          disabled={chatBusy}
          title={chatBusy ? t("builder.swapBlocked") : undefined}
          onClick={() => {
            // Switching mid-turn would splice one session's stream into another view.
            if (chatBusy) return;
            onSwitch(session.id);
          }}
        >
          <Bot size={13} />
          <span className="builder-session-name">{session.name}</span>
          <SessionMeta session={session} />
        </button>
      )}
      <SessionRowControls
        session={session}
        renaming={renaming}
        onAbort={onAbort}
        onDelete={onDelete}
        onStartRename={onStartRename}
      />
    </div>
  );
}
