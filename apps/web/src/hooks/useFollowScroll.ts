/**
 * @file useFollowScroll
 * @description Auto-follow a streaming scroll container with user-detach semantics.
 *
 * Responsibilities:
 * - Keep the container pinned to the bottom while content streams
 * - Detach ONLY on a genuine upward scroll (scrollTop decreasing). Scroll events
 *   caused by content growth carry an unchanged scrollTop and never detach — the
 *   pre-fix atBottom check did, which stopped following with no user action
 * - Re-attach when the user scrolls back to the bottom; expose a jump button
 *
 * Shared by the arena ColumnCard and the builder ChatPanel.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Distance from the bottom (px) that still counts as "at the bottom". */
const BOTTOM_THRESHOLD_PX = 48;

/**
 * Streaming-scroll follow with user-detach semantics.
 *
 * @param deps Growth signals of the streamed content (effects re-pin on change);
 *   pass the same array identity discipline as a useEffect dependency list.
 * @returns Ref for the scroll container, whether the user is detached (drives a
 *   jump button), the container's onScroll, and jump-to-bottom.
 */
export function useFollowScroll(deps: ReadonlyArray<unknown>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const lastTopRef = useRef(0);
  const [detached, setDetached] = useState(false);

  useEffect(() => {
    const node = scrollRef.current;
    if (node === null || !followRef.current) return;
    node.scrollTop = node.scrollHeight;
    lastTopRef.current = node.scrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the caller's growth signals
  }, deps);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (node === null) return;
    const previous = lastTopRef.current;
    lastTopRef.current = node.scrollTop;
    // A genuine upward scroll is always the user: detach. Content growth fires
    // scroll events with an unchanged scrollTop — those must keep following.
    if (node.scrollTop < previous - 1) {
      followRef.current = false;
      setDetached(true);
      return;
    }
    // Scrolling back down to the tail re-arms following; a downward scroll that
    // has not reached the tail yet leaves the current mode untouched.
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < BOTTOM_THRESHOLD_PX;
    if (atBottom) {
      followRef.current = true;
      setDetached(false);
    }
  }, []);

  const jumpToBottom = useCallback(() => {
    const node = scrollRef.current;
    if (node === null) return;
    followRef.current = true;
    setDetached(false);
    node.scrollTop = node.scrollHeight;
    lastTopRef.current = node.scrollTop;
  }, []);

  return { scrollRef, detached, handleScroll, jumpToBottom };
}
