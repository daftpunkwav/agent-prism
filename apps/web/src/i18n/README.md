# i18n

Usage notes for the `apps/web/src/i18n` module. The module implements preference-based
locale resolution, typed catalogs, and long-form content modules.

## Layout

```
i18n/
  locale.ts              AppLocale union, SUPPORTED_LOCALES, DEFAULT_LOCALE, normalizeLocale
  constants.ts           storage key, cookie name, cookie max-age, mirrors src/theme.ts
  adapters/              LocaleAdapter port and the storageCookieAdapter implementation
  catalogs/              short UI copy; zh-CN is the source of truth and en is type-pinned to it
                         namespaces: common/shell/meta/errors/arena/dimensions/settings/…
  resolveMessage.ts      dot-key lookup, {param} interpolation, fallback chain
  format.ts              formatDateTime and formatNumber bound to the active locale
  I18nProvider.tsx       client context with locale state, setLocale, and <html> sync
  useT.ts                useLocale, useSetLocale, useT; what feature code imports
  getServerLocale.ts     server-side locale for layout metadata, reading the mirror cookie
  bootstrapScript.ts     pre-paint inline script that must mirror normalizeLocale; test-locked
  content/               long-form page content for guide and learn, one module per locale
```

Dimension and baseline option labels ship from the API as English canonical strings, which
are the aggregation keys. The Arena UI overlays them through `catalogs/*/dimensions.ts` and
`app/arena/dimensionLabels.ts`. Feature components do not hardcode locale strings.

## Using copy in a component

```tsx
import { useT, useLocale } from "@/i18n/useT";
import { formatDateTime } from "@/i18n/format";

function Row({ createdAt }: { createdAt: string }) {
  const t = useT();
  const locale = useLocale();
  return <p>{t("projects.resultCount", { count: 3 })} · {formatDateTime(locale, createdAt)}</p>;
}
```

- Add the key to both `catalogs/zh-CN/<ns>.ts` and `catalogs/en/<ns>.ts`. The `en` catalog
  is annotated with `MessageCatalog`, so a missing or extra key fails `pnpm typecheck`.
- Interpolation uses `{name}` placeholders only. There are no plurals or ICU; split keys
  instead.
- Do not concatenate `t()` results, read `localStorage` for locale in feature code, or
  hardcode `"zh-CN"` in `toLocaleString`. Use `format.ts`.
- A missing key renders `⟦key⟧` with a console warning in development and the raw key in
  production. Empty strings are never produced silently.

## Long-form content

Views call `selectGuideContent(locale)` or `selectLearnContent(locale)` from
`i18n/content/*`. Page prose lives there, not in the message catalogs. A view never
imports a single locale's content file directly.

## Adding a language

1. `locale.ts`: add the code to `AppLocale`, `SUPPORTED_LOCALES`, and the alias table, for
   example `ja-JP → ja`.
2. Copy `catalogs/zh-CN/` to `catalogs/<code>/` and translate every namespace. Register it
   in `catalogs/index.ts`. Typecheck enforces structural parity.
3. Copy `content/guide/zh-CN.ts` to `<code>.ts`, and the learn content likewise,
   translate, and register in the selector.
4. Add the option through `LOCALE_NATIVE_LABELS` in `locale.ts` as an endonym. `AppShell`
   builds the toggle list from `SUPPORTED_LOCALES` and those labels.
5. Extend the shared decision table in `apps/web/tests/locale-bootstrap.test.ts`, which
   covers `normalizeLocale` and pre-paint pick parity.
6. Run `pnpm --filter @agentprism/web check:i18n` and `pnpm typecheck`.
7. `resolveMessage`, `I18nProvider`, the adapters, and feature pages need no changes.

## Checks

- `pnpm --filter @agentprism/web check:i18n` checks catalog key parity through
  `apps/web/tests/catalog-parity.test.ts`, plus a CJK sweep over `src/app` and
  `src/components`. Comments and console calls are exempt.
- `packages/ui` stays copy-free. Toggle and panel labels are injected as props from the
  shell.
