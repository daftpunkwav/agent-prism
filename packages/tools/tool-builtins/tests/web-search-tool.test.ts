/**
 * @file web_search tool tests
 * @description Locks fail-closed setup, localhost provider round-trip, and input validation.
 */

import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { webSearchTool } from "@agentprism/tool-builtins";

const workspace = { name: "ws", root: "", cwd: () => "", fs: null };

function withEnv(env: Record<string, string | undefined>, task: () => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key] as string;
  }
  return task().finally(() => {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key] as string;
    }
  });
}

describe("webSearchTool", () => {
  it("fails closed with a setup hint when unconfigured", async () => {
    await withEnv({ SEARCH_PROVIDER: undefined, SEARCH_API_KEY: undefined, SEARCH_API_URL: undefined }, async () => {
      const out = await webSearchTool.execute(workspace, { query: "anything" });
      expect(out.ok).toBe(false);
      expect(out.result).toContain("SEARCH_PROVIDER");
    });
  });

  it("fails closed when the provider is unknown or the key is missing", async () => {
    await withEnv({ SEARCH_PROVIDER: "nope", SEARCH_API_KEY: "k" }, async () => {
      expect((await webSearchTool.execute(workspace, { query: "x" })).ok).toBe(false);
    });
    await withEnv({ SEARCH_PROVIDER: "exa", SEARCH_API_KEY: undefined }, async () => {
      const out = await webSearchTool.execute(workspace, { query: "x" });
      expect(out.ok).toBe(false);
      expect(out.result).toContain("SEARCH_API_KEY");
    });
  });

  it("rejects blank queries without touching the network", async () => {
    await withEnv({ SEARCH_PROVIDER: "exa", SEARCH_API_KEY: "k" }, async () => {
      const out = await webSearchTool.execute(workspace, { query: "  " });
      expect(out.ok).toBe(false);
      expect(out.code).toBe("workspace_error");
    });
  });

  it("maps the real AbortSignal.timeout rejection (TimeoutError) to the timeout message", async () => {
    // Node aborts an AbortSignal.timeout with a DOMException named "TimeoutError", not
    // "AbortError": without that branch a real timeout surfaced as "search request failed".
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as typeof fetch;
    try {
      await withEnv(
        { SEARCH_PROVIDER: "exa", SEARCH_API_KEY: "k", SEARCH_API_URL: "https://search.test/api" },
        async () => {
          const out = await webSearchTool.execute(workspace, { query: "prism" });
          expect(out.ok).toBe(false);
          expect(out.result).toContain("search timed out");
        },
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it("reports caller cancellation as aborted, not as a timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new DOMException("Aborted", "AbortError");
    }) as typeof fetch;
    try {
      await withEnv(
        { SEARCH_PROVIDER: "exa", SEARCH_API_KEY: "k", SEARCH_API_URL: "https://search.test/api" },
        async () => {
          const out = await webSearchTool.execute(workspace, { query: "prism" }, controller.signal);
          expect(out.ok).toBe(false);
          expect(out.code).toBe("aborted");
          expect(out.result).toBe("Error: aborted");
        },
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it("maps a timeout while reading the response body to the timeout message", async () => {
    // The body read is governed by the same AbortSignal.timeout as the request; before
    // the shared mapper a stalled payload surfaced as "unreadable search response".
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    })) as unknown as typeof fetch;
    try {
      await withEnv(
        { SEARCH_PROVIDER: "exa", SEARCH_API_KEY: "k", SEARCH_API_URL: "https://search.test/api" },
        async () => {
          const out = await webSearchTool.execute(workspace, { query: "prism" });
          expect(out.ok).toBe(false);
          expect(out.code).toBe("workspace_error");
          expect(out.result).toBe("Error: search timed out");
        },
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it("keeps a caller abort during the body read as aborted", async () => {
    const controller = new AbortController();
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      },
    })) as unknown as typeof fetch;
    try {
      await withEnv(
        { SEARCH_PROVIDER: "exa", SEARCH_API_KEY: "k", SEARCH_API_URL: "https://search.test/api" },
        async () => {
          const out = await webSearchTool.execute(workspace, { query: "prism" }, controller.signal);
          expect(out.ok).toBe(false);
          expect(out.code).toBe("aborted");
          expect(out.result).toBe("Error: aborted");
        },
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it("round-trips an exa-shaped localhost backend", async () => {
    const server = createServer((req, res) => {
      expect(req.headers["x-api-key"]).toBe("test-key");
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        expect(JSON.parse(body).query).toBe("prism");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ results: [{ title: "T", url: "https://t.example", text: "S" }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      await withEnv(
        { SEARCH_PROVIDER: "exa", SEARCH_API_KEY: "test-key", SEARCH_API_URL: `http://127.0.0.1:${port}/search` },
        async () => {
          const out = await webSearchTool.execute(workspace, { query: "prism" });
          expect(out.ok).toBe(true);
          expect(out.result).toContain("1. T");
          expect(out.result).toContain("https://t.example");
        },
      );
    } finally {
      server.close();
    }
  });
});
