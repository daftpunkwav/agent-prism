/**
 * @file builder/page
 * @description The /builder route page.
 *
 * Responsibilities:
 * - Mount the Agent Builder client shell
 */

import "./builder.css";
import { BuilderClient } from "./BuilderClient";

/** Builder route: single-agent sessions with composition hot-swap. */
export default function BuilderPage() {
  return <BuilderClient />;
}
