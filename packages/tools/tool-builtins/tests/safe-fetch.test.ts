/**
 * @file safe-fetch charset tests
 * @description Locks body charset resolution and capped streaming decode.
 *
 * Responsibilities:
 * - Pin resolveCharset precedence: BOM > header charset > meta/XML sniff > UTF-8
 * - Pin readBodyCapped: non-UTF-8 decode, multi-byte sequences split across
 *   chunks, maxChars truncation, and empty-stream behavior
 */

import { describe, expect, it } from "vitest";
import { readBodyCapped, resolveCharset } from "@agentprism/tool-builtins";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function responseOf(chunks: Uint8Array[], contentType?: string): Response {
  const headers = contentType === undefined ? undefined : { "content-type": contentType };
  return new Response(streamOf(chunks), { headers });
}

describe("resolveCharset", () => {
  const utf8 = new TextEncoder().encode("<html></html>");

  it("prefers the Content-Type charset parameter", () => {
    expect(resolveCharset("text/html; charset=GBK", utf8)).toBe("gbk");
    expect(resolveCharset('text/html; charset="utf-8"', utf8)).toBe("utf-8");
  });

  it("gives the BOM precedence over a conflicting header", () => {
    expect(resolveCharset("text/html; charset=gbk", new Uint8Array([0xef, 0xbb, 0xbf, 0x3c]))).toBe("utf-8");
    expect(resolveCharset("text/html; charset=utf-8", new Uint8Array([0xff, 0xfe, 0x3c]))).toBe("utf-16le");
  });

  it("sniffs a meta charset declaration when the header is silent", () => {
    const meta = new TextEncoder().encode('<html><head><meta charset="gb2312"></head>');
    expect(resolveCharset(null, meta)).toBe("gb2312");
    const quoted = new TextEncoder().encode("<meta http-equiv='Content-Type' content='text/html; charset=gbk'>");
    expect(resolveCharset(undefined, quoted)).toBe("gbk");
  });

  it("sniffs an XML encoding declaration", () => {
    const xml = new TextEncoder().encode('<?xml version="1.0" encoding="gbk"?>');
    expect(resolveCharset(null, xml)).toBe("gbk");
  });

  it("falls back to utf-8 when nothing declares or supports the charset", () => {
    expect(resolveCharset(null, utf8)).toBe("utf-8");
    expect(resolveCharset("text/html", utf8)).toBe("utf-8");
    expect(resolveCharset("text/html; charset=x-unknown-9x", utf8)).toBe("utf-8");
  });
});

describe("readBodyCapped", () => {
  // "中文" is GBK bytes D6 D0 CE C4; TextEncoder cannot produce these.
  const GBK_ZHONGWEN = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);

  it("decodes a GBK body through the declared header charset", async () => {
    const text = await readBodyCapped(responseOf([GBK_ZHONGWEN], "text/html; charset=gbk"), 1000, AbortSignal.timeout(5000));
    expect(text).toBe("中文");
  });

  it("keeps a multi-byte sequence split across chunk boundaries intact", async () => {
    const split = responseOf([new Uint8Array([0xd6]), new Uint8Array([0xd0, 0xce, 0xc4])], "text/html; charset=gbk");
    const text = await readBodyCapped(split, 1000, AbortSignal.timeout(5000));
    expect(text).toBe("中文");
  });

  it("decodes a GBK body that only declares its charset via a meta tag", async () => {
    const meta = new TextEncoder().encode('<meta charset="gbk">');
    const body = new Uint8Array([...meta, ...GBK_ZHONGWEN]);
    const text = await readBodyCapped(responseOf([body], "text/html"), 1000, AbortSignal.timeout(5000));
    expect(text).toBe('<meta charset="gbk">中文');
  });

  it("still caps the decoded text at maxChars", async () => {
    const text = await readBodyCapped(responseOf([GBK_ZHONGWEN], "text/html; charset=gbk"), 1, AbortSignal.timeout(5000));
    expect(text).toBe("中");
  });

  it("returns an empty string for an empty stream", async () => {
    const text = await readBodyCapped(responseOf([], "text/plain"), 1000, AbortSignal.timeout(5000));
    expect(text).toBe("");
  });
});
