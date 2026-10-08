/**
 * @file useArenaAttachments
 * @description Composer attachment state for the Arena page.
 *
 * Responsibilities:
 * - Hold the text files seeded into the columns' fresh workspaces for the next run
 * - Validate picked files (count, size, duplicates) with limit errors surfaced
 *   through the run error banner
 * - Clear the list once a settled run has seeded it
 *
 * The ref mirrors the state so the async reader validates against fresh data
 * while multiple files are in flight.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunAttachment } from "@agentprism/client";
import { useT } from "@/i18n/useT";

type TFn = ReturnType<typeof useT>;

/** Attachment limits: mirrored by the server-side RunAttachmentSchema (defense in depth). */
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 64 * 1024;
const MAX_ATTACHMENT_CHARS = 64 * 1024;

/** Composer attachment state + validation. */
export function useArenaAttachments(onError: (message: string | null) => void, t: TFn) {
  const [attachments, setAttachments] = useState<RunAttachment[]>([]);
  /** Mirrors the attachments state so the async reader validates against fresh data. */
  const attachmentsRef = useRef<RunAttachment[]>([]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  /** Reads picked files as text into attachments; validation failures surface via the run error banner. */
  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      onError(null);
      for (const file of files) {
        if (attachmentsRef.current.length >= MAX_ATTACHMENTS) {
          onError(t("arena.attach.tooMany"));
          break;
        }
        if (attachmentsRef.current.some((a) => a.name === file.name)) continue;
        if (file.size > MAX_ATTACHMENT_BYTES) {
          onError(t("arena.attach.tooLarge", { name: file.name }));
          continue;
        }
        try {
          const content = (await file.text()).slice(0, MAX_ATTACHMENT_CHARS);
          if (attachmentsRef.current.some((a) => a.name === file.name) || attachmentsRef.current.length >= MAX_ATTACHMENTS) {
            continue;
          }
          const next = [...attachmentsRef.current, { name: file.name, content }];
          attachmentsRef.current = next;
          setAttachments(next);
        } catch (error) {
          console.warn(`[arena] Attachment read failed: ${file.name}`, error);
        }
      }
    },
    [onError, t],
  );

  const handleRemoveAttachment = useCallback((name: string) => {
    setAttachments((prev) => prev.filter((a) => a.name !== name));
  }, []);

  /** Drops the list after a settled run seeded it (or on conversation reset). */
  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  return { attachments, handleAttachFiles, handleRemoveAttachment, clearAttachments };
}
