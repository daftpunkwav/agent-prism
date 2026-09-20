/**
 * @file sse
 * @description Shared Server-Sent Events body pump for streaming endpoints.
 *
 * Responsibilities:
 * - Assemble data: lines into blank-line-delimited blocks (plus a trailing partial block)
 * - Skip comment/event/id/retry lines the backend never uses for payloads
 * - End silently on user abort; never leak the reader lock
 *
 * Both arena runs and builder chat stream the same wire shape; the only
 * per-endpoint differences (payload type, [DONE] handling) stay at the call sites.
 */

import { isAbortError } from "./http.js";

/**
 * Pumps one SSE response body, invoking onData per assembled data block
 * (multi-line data: payloads joined with "\n", trimmed).
 */
export async function pumpSSEBlocks(
  res: Response,
  onData: (data: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const body = res.body;
  if (body === null) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  const flush = (): void => {
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n").trim();
    dataLines = [];
    if (data !== "") onData(data);
  };
  const pushLine = (rawLine: string): void => {
    if (rawLine === "") return;
    if (rawLine.startsWith(":")) return;
    if (rawLine.startsWith("data:")) dataLines.push(rawLine.slice(5).trimStart());
    // event:/id:/retry: lines carry no payload on this backend; ignored.
  };
  try {
    for (;;) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await reader.read();
      } catch (error) {
        // Aborting mid-read is the expected stop path (pressing "stop"); anything else propagates.
        if (isAbortError(error) || signal?.aborted) return;
        throw error;
      }
      if (read.done) break;
      buffer += decoder.decode(read.value, { stream: true });
      // Split on event-block boundaries; the last chunk may hold a partial block.
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const rawLine of part.split(/\r?\n/)) pushLine(rawLine);
        flush();
      }
    }
    // Flush the decoder (a trailing multi-byte character) and a final block
    // closed by connection end instead of a blank line.
    buffer += decoder.decode();
    if (buffer.trim() !== "") {
      for (const rawLine of buffer.split(/\r?\n/)) pushLine(rawLine);
      flush();
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Releasing after an abort throws; the stream is already gone, so ignore.
    }
  }
}
