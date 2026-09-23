/**
 * @file openai-responses-compat
 * @description Boundary normalization for OpenAI Responses API payloads.
 *
 * Responsibilities:
 * - Coerce vendor quirks in Responses payloads before the SDK converters see them
 * - Wrap fetch so both the SSE stream and the JSON body of /responses calls are patched
 *
 * Why: MiniMax (and possibly other gateways) return `annotations: null` on
 * output_text parts; @langchain/openai's Responses converter calls
 * `part.annotations.map(...)` unconditionally, so one null kills the whole run
 * with a bare TypeError (sanitized away from the client). The SDK has no guard
 * (checked through 1.5.13), so the normalization lives here, at the only seam
 * we own. Pure payload patching: no retry, no swallowing, unknown shapes pass
 * through untouched.
 */

/** Minimal structural fetch types (this package's tsconfig has no DOM lib). */
type FetchInput = string | URL | Request;
type FetchLike = (input: FetchInput, init?: RequestInit) => Promise<Response>;

/** Patches one Responses event / response object in place (also returns it). */
export function patchResponsesEvent(event: unknown): unknown {
  if (event === null || typeof event !== "object") return event;
  const record = event as Record<string, unknown>;
  if (Array.isArray(record["output"])) patchOutputArray(record["output"] as unknown[]);
  const response = record["response"];
  if (response !== null && typeof response === "object" && Array.isArray((response as Record<string, unknown>)["output"])) {
    patchOutputArray((response as Record<string, unknown>)["output"] as unknown[]);
  }
  const item = record["item"];
  if (item !== null && typeof item === "object" && Array.isArray((item as Record<string, unknown>)["content"])) {
    patchContentParts((item as Record<string, unknown>)["content"] as unknown[]);
  }
  return event;
}

/** output[] items: message items fall through to their content parts. */
function patchOutputArray(output: unknown[]): void {
  for (const item of output) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record["type"] === "message" && Array.isArray(record["content"])) {
      patchContentParts(record["content"] as unknown[]);
    }
  }
}

/** content[] parts: output_text with null annotations breaks the SDK converter. */
function patchContentParts(content: unknown[]): void {
  for (const part of content) {
    if (part === null || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (record["type"] === "output_text" && record["annotations"] === null) {
      record["annotations"] = [];
    }
  }
}

/**
 * Patches one SSE data line; comments, blanks, and unparseable payloads pass
 * through. SSE terminators are LF, CRLF, or CR and the `data:` prefix may omit
 * the space, so both variants are parsed: a CRLF frame split on "\n" carries a
 * trailing "\r" into the JSON payload, and an unparsed payload would silently
 * skip the patch (the exact crash this layer exists to prevent).
 */
function patchSseLine(line: string): string {
  const match = /^data: ?/.exec(line);
  if (match === null) return line;
  const prefix = match[0];
  const body = line.slice(prefix.length);
  const terminator = body.endsWith("\r") ? "\r" : "";
  const payload = terminator !== "" ? body.slice(0, -1) : body;
  if (payload === "[DONE]") return line;
  try {
    return `${prefix}${JSON.stringify(patchResponsesEvent(JSON.parse(payload)))}${terminator}`;
  } catch {
    return line;
  }
}

/** Streams a Response body line-by-line, patching each SSE data line. */
function patchSseBody(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) controller.enqueue(encoder.encode(patchSseLine(line) + "\n"));
    },
    flush(controller) {
      if (buffer !== "") controller.enqueue(encoder.encode(patchSseLine(buffer)));
    },
  });
  return body.pipeThrough(transform);
}

/** Patches a non-streaming JSON response body (the invoke path hits this). */
async function patchJsonBody(response: Response): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text());
  } catch {
    return response;
  }
  return new Response(JSON.stringify(patchResponsesEvent(parsed)), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function isResponsesPost(input: FetchInput, init?: RequestInit): boolean {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "POST") return false;
  const url = input instanceof Request ? input.url : String(input);
  return url.endsWith("/responses");
}

/**
 * Fetch wrapper for OpenAI-Responses-compatible endpoints: POST /responses
 * responses get their payload normalized (streaming SSE and JSON alike);
 * every other request passes through untouched.
 */
export function createResponsesCompatFetch(inner: FetchLike = fetch): FetchLike {
  return async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const response = await inner(input, init);
    if (!isResponsesPost(input, init)) return response;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      if (response.body === null) return response;
      return new Response(patchSseBody(response.body), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    if (contentType.includes("application/json")) return patchJsonBody(response);
    return response;
  };
}
