/**
 * @file global-error
 * @description Root-layout error boundary that renders its own html/body.
 *
 * Responsibilities:
 * - Catch layout-level failures and self-bootstrap the markup
 *
 * Cannot rely on I18nProvider: resolves the locale from the LocaleAdapter
 * and reads the catalog directly.
 */

"use client";

import { useEffect, useState } from "react";
// global-error replaces the root layout, so the design system must be imported
// here too or the boundary renders with browser-default styles.
import "@agentprism/ui/styles/global.css";
import { storageCookieAdapter } from "@/i18n/adapters/storageCookieAdapter";
import { getCatalog } from "@/i18n/catalogs";
import { DEFAULT_LOCALE, normalizeLocale, type AppLocale } from "@/i18n/locale";

/**
 * Root-layout error boundary — catches layout-level errors.
 * Must carry its own html/body since the root layout may have already failed.
 *
 * First render uses the default locale (matching SSR); after mount it re-reads the
 * stored preference client-side, keeping hydration consistent without warnings.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale, setLocale] = useState<AppLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    setLocale((prev) => {
      const stored = normalizeLocale(storageCookieAdapter.readClient());
      return stored === prev ? prev : stored;
    });
  }, []);

  const t = getCatalog(locale).errors.global;

  return (
    <html lang={locale}>
      <body>
        <main className="error-boundary">
          <h1>{t.title}</h1>
          <p>{t.body}</p>
          {error.digest ? (
            <p className="error-boundary-digest">{t.digest.replace("{digest}", error.digest)}</p>
          ) : null}
          <div className="error-boundary-actions">
            <button type="button" className="btn-primary" onClick={reset}>
              {t.retry}
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
