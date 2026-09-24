/**
 * @file layout
 * @description The app's root layout: fonts, shell, and pre-paint scripts.
 *
 * Responsibilities:
 * - Render the global shell and load fonts and styles
 * - Resolve the SSR locale from the mirror cookie for html lang and metadata
 * - Inject the pre-paint theme/locale scripts
 */

import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "@agentprism/ui/styles/global.css";
import { AppShell } from "@/components/AppShell";
import { THEME_STORAGE_KEY } from "@/theme";
import { getCatalog } from "@/i18n/catalogs";
import { localeBootstrapScript } from "@/i18n/bootstrapScript";
import { getServerLocale } from "@/i18n/getServerLocale";
import { I18nProvider } from "@/i18n/I18nProvider";

/** Localized document title and description for the current request locale. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  const { meta } = getCatalog(locale);
  return {
    title: meta.title,
    description: meta.description,
  };
}

// Sets the theme from localStorage before the first paint to avoid flicker; dark is the default
const themeScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}')||'dark';if(t==='dark'){document.documentElement.classList.add('dark');}else{document.documentElement.classList.remove('dark');}}catch(e){document.documentElement.classList.add('dark');}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getServerLocale();

  return (
    <html
      lang={locale}
      data-locale={locale}
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('agentprism-skin');if(s==='claude'){document.documentElement.dataset.theme='claude';}}catch(e){}})();`,
          }}
        />
        <script dangerouslySetInnerHTML={{ __html: localeBootstrapScript }} />
      </head>
      <body className="antialiased">
        <I18nProvider initialLocale={locale}>
          <AppShell>{children}</AppShell>
        </I18nProvider>
      </body>
    </html>
  );
}
