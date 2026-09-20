/**
 * @file page
 * @description The root route: redirects into the Arena page.
 *
 * Responsibilities:
 * - Redirect / to /arena
 */

import { redirect } from "next/navigation";

/** Landing route: product entry points. */
export default function Home() {
  redirect("/arena");
}
