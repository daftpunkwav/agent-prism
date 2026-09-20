/**
 * @file error
 * @description Route-level error boundary with retry.
 *
 * Responsibilities:
 * - Catch render errors and offer a retry instead of a blank page
 *
 * The root layout still wraps this boundary, so copy goes through useT().
 */

"use client";

import Link from "next/link";
import { useT } from "@/i18n/useT";

/** Route-level error boundary — catches render errors and offers a retry. */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();

  return (
    <main className="error-boundary">
      <h1>{t("errors.route.title")}</h1>
      <p>{t("errors.route.body")}</p>
      {error.digest ? (
        <p className="error-boundary-digest">{t("errors.route.digest", { digest: error.digest })}</p>
      ) : null}
      <div className="error-boundary-actions">
        <button type="button" className="btn-primary" onClick={reset}>
          {t("errors.route.retry")}
        </button>
        <Link href="/" className="btn-ghost">
          {t("errors.route.backHome")}
        </Link>
      </div>
    </main>
  );
}
