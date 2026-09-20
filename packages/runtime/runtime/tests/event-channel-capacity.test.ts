/**
 * @file event-channel-capacity tests
 * @description Covers the bounded channel mode for slow-consumer backpressure.
 */

import { describe, expect, it } from "vitest";
import { EventChannel } from "@agentprism/runtime";

describe("EventChannel capacity", () => {
  it("buffers unbounded by default", () => {
    const channel = new EventChannel<number>();
    channel.push(1);
    channel.push(2);
    expect(channel.size()).toBe(2);
    expect(channel.droppedCount()).toBe(0);
  });

  it("drops the oldest buffered item past capacity", async () => {
    const channel = new EventChannel<number>({ capacity: 2 });
    channel.push(1);
    channel.push(2);
    channel.push(3);
    expect(channel.size()).toBe(2);
    expect(channel.droppedCount()).toBe(1);
    expect(await channel.receive(10)).toEqual({ kind: "item", value: 2 });
    expect(await channel.receive(10)).toEqual({ kind: "item", value: 3 });
  });
});
