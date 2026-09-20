# i18n

> 语言：**简体中文** | [English](README.md)

`apps/web/src/i18n` 模块的使用说明。该模块实现基于偏好的 locale 解析、带类型的
catalog 与长文本内容模块。

## 布局

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

dimension 与 baseline 选项 label 由 API 以英文规范字符串下发，这些字符串是聚合键。
Arena UI 经 `catalogs/*/dimensions.ts` 与 `app/arena/dimensionLabels.ts` 覆盖它们。
功能组件不硬编码 locale 字符串。

## 在组件中使用文案

```tsx
import { useT, useLocale } from "@/i18n/useT";
import { formatDateTime } from "@/i18n/format";

function Row({ createdAt }: { createdAt: string }) {
  const t = useT();
  const locale = useLocale();
  return <p>{t("projects.resultCount", { count: 3 })} · {formatDateTime(locale, createdAt)}</p>;
}
```

- key 同时加入 `catalogs/zh-CN/<ns>.ts` 与 `catalogs/en/<ns>.ts`。`en` catalog 以
  `MessageCatalog` 标注，因此 key 缺失或多余都会使 `pnpm typecheck` 失败。
- 插值只使用 `{name}` 占位符。没有复数或 ICU，改为拆分 key。
- 不要拼接 `t()` 结果，不要在功能代码中为 locale 读取 `localStorage`，也不要在
  `toLocaleString` 中硬编码 `"zh-CN"`。使用 `format.ts`。
- key 缺失时，开发环境渲染 `⟦key⟧` 并输出 console 警告，生产环境渲染原始 key。绝不
  静默产生空字符串。

## 长文本内容

视图调用 `i18n/content/*` 中的 `selectGuideContent(locale)` 或
`selectLearnContent(locale)`。页面文案放在那里，而非消息 catalog。视图绝不直接 import
单个 locale 的内容文件。

## 新增语言

1. `locale.ts`：把语言码加入 `AppLocale`、`SUPPORTED_LOCALES` 与别名表，例如
   `ja-JP → ja`。
2. 把 `catalogs/zh-CN/` 复制到 `catalogs/<code>/`，翻译每个 namespace，并在
   `catalogs/index.ts` 注册。typecheck 强制结构对等。
3. 把 `content/guide/zh-CN.ts` 复制为 `<code>.ts`，learn 内容同理，翻译后在 selector
   中注册。
4. 经 `locale.ts` 中的 `LOCALE_NATIVE_LABELS` 以 endonym 形式加入该选项。`AppShell`
   从 `SUPPORTED_LOCALES` 与这些 label 构建切换列表。
5. 扩展 `apps/web/tests/locale-bootstrap.test.ts` 中的共享决策表，它覆盖
   `normalizeLocale` 与 pre-paint 选择一致性。
6. 运行 `pnpm --filter @agentprism/web check:i18n` 与 `pnpm typecheck`。
7. `resolveMessage`、`I18nProvider`、adapters 与功能页面无需改动。

## 检查

- `pnpm --filter @agentprism/web check:i18n` 经
  `apps/web/tests/catalog-parity.test.ts` 检查 catalog key 对等，并对 `src/app` 与
  `src/components` 做 CJK 扫描。注释与 console 调用豁免，`tokenEstimate.ts` 的示例
  载荷在白名单中。
- `packages/ui` 保持无文案。切换与面板 label 由 shell 经 props 注入。
