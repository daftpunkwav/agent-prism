/**
 * @file transport test
 * @description Locks MCP stdio framing against a real child process (not the in-memory duplex).
 */
import { describe, expect, it } from "vitest";
import { NodeMcpTransport } from "../src/transport.js";

/**
 * Child server speaking the MCP stdio framing: one JSON object per line in and out.
 * It answers `tools/call` with a non-ASCII payload flushed in TWO chunks that split
 * the 4-byte emoji sequence, so a decoder that ignores incremental UTF-8 handling
 * corrupts the body.
 */
const SERVER_SCRIPT = `
let buffer = "";
const chunks = (json) => {
  const framed = Buffer.from(json + "\\n", "utf8");
  const found = framed.indexOf(Buffer.from("🇨🇳", "utf8"));
  const at = found === -1 ? framed.length : found + 2;
  return [framed.subarray(0, at), framed.subarray(at)];
};
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  for (;;) {
    const index = buffer.indexOf("\\n");
    if (index === -1) return;
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line === "") continue;
    const request = JSON.parse(line);
    const result = request.method === "tools/call"
      ? { result: { content: [{ type: "text", text: "中文🇨🇳 payload" }] } }
      : { result: { ok: true, method: request.method } };
    const reply = JSON.stringify({ jsonrpc: "2.0", id: request.id, ...result });
    const [head, tail] = chunks(reply);
    process.stdout.write(head);
    setTimeout(() => process.stdout.write(tail), 5);
  }
});
`;

describe("NodeMcpTransport", { retry: 1 }, () => {
  it("round-trips newline-framed JSON with a real child, multi-byte safe", async () => {
    const transport = new NodeMcpTransport();
    const child = transport.spawn(process.execPath, ["-e", SERVER_SCRIPT]);
    try {
      child.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
      child.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {} }));
      const bodies: string[] = [];
      for await (const body of child.messages()) {
        bodies.push(body);
        if (bodies.length === 2) break;
      }
      // A single line per message: the transport must neither frame with headers
      // (the child would fail to JSON.parse our initialize) nor hold bytes back.
      expect(bodies.every((body) => !body.includes("\n"))).toBe(true);
      const replies = bodies.map((body) => JSON.parse(body) as Record<string, unknown>);
      expect(replies[0]).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true, method: "initialize" } });
      expect(replies[1]).toEqual({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: "中文🇨🇳 payload" }] },
      });
    } finally {
      child.kill();
      await child.exited();
    }
  });
});
