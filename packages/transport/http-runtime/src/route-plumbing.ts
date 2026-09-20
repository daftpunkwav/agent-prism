/**
 * @file routes/route-plumbing
 * @description Shared route plumbing: app type, body limits, JSON parsing.
 *
 * Responsibilities:
 * - Define the HttpApp shape used by all route registrars
 * - Assert request body size limits
 * - Provide raw and validated JSON body parsing
 */

import type { Context } from "hono";
import type { Hono } from "hono";
import type { Settings } from "@agentprism/config";
import { AppError, firstIssueMessage } from "@agentprism/application";

/** Transport app type: all route groups share the same middleware context. */
export type HttpApp = Hono<{ Variables: { appSettings: Settings } }>;

/**
 * Reads validated service settings from the request context (injected by middleware).
 *
 * @param c Request context carrying appSettings.
 * @returns Service settings for limits, ports, and tokens.
 */
export function settingsOf(c: Context): Settings {
  return c.get("appSettings") as Settings;
}

/** Request-body 413 decision shared by the Content-Length precheck and the streaming reader. */
export function assertBodySize(sizeBytes: number, settings: Settings): void {
  if (sizeBytes > settings.maxRequestSize) {
    throw new AppError(413, `Request body exceeds max size (${Math.floor(settings.maxRequestSize / 1024 / 1024)}MB)`);
  }
}

/**
 * Reads the raw request body text with the size limit enforced while streaming.
 * c.req.text() would buffer the whole body first, letting a chunked request without
 * Content-Length bypass the limit until memory is exhausted.
 */
export async function readRawBodyText(c: Context): Promise<string> {
  const settings = settingsOf(c);
  const body = c.req.raw.body;
  if (body === null || body === undefined) {
    return "";
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > settings.maxRequestSize) {
        await reader.cancel().catch(() => {});
        assertBodySize(total, settings);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads the raw JSON request body (streaming size limit; empty body parses as {}). */
export async function readJsonRaw(c: Context): Promise<unknown> {
  const raw = await readRawBodyText(c);
  try {
    return raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    throw new AppError(400, "Request body is not valid JSON");
  }
}

/** Minimal structural view of a schema (compatible with any Zod version). */
interface SchemaLike<T> {
  safeParse(
    data: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } };
}

/**
 * Parses and validates a JSON request body.
 *
 * @param c Request context (streaming size limit enforced while reading).
 * @param schema Zod-compatible schema with safeParse.
 * @returns Validated payload.
 * @throws AppError 400 on malformed JSON, 422 on schema mismatch, 413 past the size limit.
 */
export async function parseJsonBody<T>(c: Context, schema: SchemaLike<T>): Promise<T> {
  const json = await readJsonRaw(c);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new AppError(422, firstIssueMessage(parsed.error));
  }
  return parsed.data;
}
