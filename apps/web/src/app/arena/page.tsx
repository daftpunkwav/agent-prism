/**
 * @file arena/page
 * @description The /arena route page.
 *
 * Responsibilities:
 * - Wrap the client component in Suspense for useSearchParams
 */

import { Suspense } from "react";
import { ArenaClient } from "./ArenaClient";

/** Arena route: comparison experiments over frameworks, prompts, and models. */
export default function ArenaPage() {
  // useSearchParams requires a Suspense boundary (a Next.js App Router requirement)
  return (
    <Suspense fallback={<div className="arena-shell items-center justify-center" />}>
      <ArenaClient />
    </Suspense>
  );
}
