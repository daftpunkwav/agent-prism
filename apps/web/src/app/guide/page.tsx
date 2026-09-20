/**
 * @file guide/page
 * @description The /guide route page.
 *
 * Responsibilities:
 * - Render long-form content from the locale-selected guide module
 * - Take fixed schema labels from the guide catalogs via useT
 */

"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, FlaskConical, ShieldAlert } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import { DIMENSION_FIELD } from "@agentprism/client";
import {
  selectGuideContent,
  type DimDoc,
  type GuideBlock,
  type GuideSection,
  type Reality,
} from "@/i18n/content/guide";
import { useLocale, useT } from "@/i18n/useT";

/** The view carries no content-varying copy (content comes from the locale-selected i18n content module); fixed schema labels come from the catalogs via useT. */

const HERO_ACTION_ICONS = {
  flask: FlaskConical,
  arrow: ArrowRight,
} as const;

/** Locale-selected guide content (stable module-level object per locale). */
function useGuideContent() {
  const locale = useLocale();
  return selectGuideContent(locale);
}

/**
 * Data copy renders uniformly through react-markdown: raw HTML is not executed by
 * default and urlTransform neutralizes dangerous protocols such as javascript: (the
 * security baseline); the paragraph shell is supplied by the caller for embedding
 * into p/li containers.
 * Link policy: in-app paths go through the Next router (protocol-relative //host
 * counts as external), anchors use native <a>, and external links open in a new
 * window with opener isolated.
 */
const DOC_MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <>{children}</>,
  a: ({ children, href }) => {
    if (!href) return <>{children}</>;
    if (href.startsWith("/") && !href.startsWith("//")) return <Link href={href}>{children}</Link>;
    if (href.startsWith("#")) return <a href={href}>{children}</a>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

/** Renders inline Markdown from the content module (`code`, **emphasis**, links); inline syntax only — block syntax such as lists/headings would produce illegal HTML nesting (hydration errors) and is forbidden in copy. */
function DocText({ text }: { text: string }) {
  return <ReactMarkdown components={DOC_MARKDOWN_COMPONENTS}>{text}</ReactMarkdown>;
}

function RealityBadge({ reality }: { reality: Reality }) {
  const { realityLabel } = useGuideContent();
  return (
    <span className="guide-badge" data-reality={reality}>
      {realityLabel[reality]}
    </span>
  );
}

function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <div className="guide-reveal" style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}>
      {children}
    </div>
  );
}

function FieldMatrixTable() {
  const t = useT();
  const { fieldMatrix } = useGuideContent();
  return (
    <div className="guide-ledger" role="table" aria-label={t("guide.table.aria")}>
      <div className="guide-ledger-head" role="row">
        <span role="columnheader">{t("guide.table.dimension")}</span>
        <span role="columnheader">{t("guide.table.field")}</span>
        <span role="columnheader">{t("guide.table.type")}</span>
        <span role="columnheader">{t("guide.table.defaultValue")}</span>
        <span role="columnheader">{t("guide.table.locked")}</span>
      </div>
      {fieldMatrix.map((row, i) => (
        <a
          key={row.dimension}
          href={`#${row.dimension}`}
          className="guide-ledger-row"
          data-lane={i % 5}
        >
          {/* No table roles here: role="row" would override the link semantics. */}
          <span className="guide-ledger-dim">
            <code>{row.dimension}</code>
          </span>
          <span>
            <code>{DIMENSION_FIELD[row.dimension]}</code>
          </span>
          <span className="guide-ledger-muted">
            {row.type}
          </span>
          <span className="guide-ledger-muted">
            {row.defaultValue}
          </span>
          <span className="guide-ledger-muted">
            {row.lockedWhen}
          </span>
        </a>
      ))}
    </div>
  );
}

function ToolsetGrid() {
  const { toolsetTable } = useGuideContent();
  return (
    <div className="guide-toolset-grid">
      {toolsetTable.map((row, i) => (
        <article key={row.id} className="guide-toolset-card" data-lane={i % 5}>
          <div className="guide-toolset-top">
            <code>{row.id}</code>
            <span>{row.label}</span>
          </div>
          <p>{row.tools}</p>
        </article>
      ))}
    </div>
  );
}

function GuideBlockView({ block }: { block: GuideBlock }) {
  const t = useT();
  switch (block.kind) {
    case "formula":
      return (
        <div className="guide-formula" aria-label={t("guide.blocks.formulaAria")}>
          {block.cards.map((card, i) => (
            <Fragment key={i}>
              {i > 0 && (
                <span className="guide-formula-plus" aria-hidden>
                  {block.operators[i - 1] ?? "+"}
                </span>
              )}
              <div className="guide-formula-card" data-lane={i % 5}>
                <span className="eyebrow">{card.tag}</span>
                <p>
                  {card.text}
                  <br />
                  <code>{card.code}</code>
                </p>
              </div>
            </Fragment>
          ))}
        </div>
      );
    case "note":
      return (
        <p className="guide-note">
          <DocText text={block.text} />
        </p>
      );
    case "steps":
      return (
        <div className="guide-block">
          <h3>{block.heading}</h3>
          <ol className="guide-path-list">
            {block.items.map((item, i) => (
              <li key={i}>
                <DocText text={item} />
              </li>
            ))}
          </ol>
        </div>
      );
    case "bullets":
      return (
        <div className="guide-block">
          <h3>{block.heading}</h3>
          <ul className="guide-code-list">
            {block.items.map((item, i) => (
              <li key={i}>
                <DocText text={item} />
              </li>
            ))}
          </ul>
        </div>
      );
    case "codeList":
      return (
        <div className="guide-block">
          <h3>{block.heading}</h3>
          <ul className="guide-code-list">
            {block.items.map((item, i) => (
              <li key={i}>
                <code>{item}</code>
              </li>
            ))}
          </ul>
        </div>
      );
    case "cards":
      return (
        <div className="guide-rule-grid">
          {block.items.map((row, i) => (
            <article key={i} className="guide-rule-card" data-lane={i % 5}>
              <h3>{row.title}</h3>
              <p>
                <DocText text={row.body} />
              </p>
            </article>
          ))}
        </div>
      );
    case "stages":
      return (
        <ol className="guide-stages">
          {block.items.map((stage, i) => (
            <li key={i} data-lane={i % 5}>
              <span className="guide-stage-index" aria-hidden>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3>{stage.title}</h3>
                <p>
                  <DocText text={stage.detail} />
                </p>
                <p className="guide-stage-mod">
                  <code>{stage.module}</code>
                </p>
              </div>
            </li>
          ))}
        </ol>
      );
    case "fieldMatrix":
      return <FieldMatrixTable />;
    case "toolsetGrid":
      return <ToolsetGrid />;
    default: {
      // Exhaustiveness guard: when the guide content gains a block kind without a renderer here, it errors at compile time here instead of silently dropping content.
      const unhandled: never = block;
      throw new Error(`Unsupported guide doc block kind: ${String(unhandled)}`);
    }
  }
}

function GuideSectionView({ section }: { section: GuideSection }) {
  return (
    <section id={section.id} className="guide-section">
      <h2>{section.title}</h2>
      {section.lead && (
        <p>
          <DocText text={section.lead} />
        </p>
      )}
      {section.blocks.map((block, i) => (
        <GuideBlockView key={i} block={block} />
      ))}
    </section>
  );
}

function DimSection({ dim, index }: { dim: DimDoc; index: number }) {
  const t = useT();
  return (
    <section
      id={dim.id}
      className="guide-section guide-dim guide-reveal"
      data-lane={index % 5}
      style={{ "--reveal-delay": `${Math.min(index * 40, 200)}ms` } as CSSProperties}
    >
      <header className="guide-dim-head">
        <div className="guide-dim-titles">
          <p className="eyebrow">{dim.id}</p>
          <h2>{dim.label}</h2>
          <p className="guide-dim-summary">{dim.summary}</p>
        </div>
        <div className="guide-dim-meta">
          <RealityBadge reality={dim.reality} />
          <code className="guide-field-chip">{DIMENSION_FIELD[dim.id]}</code>
        </div>
      </header>

      <div className="guide-block">
        <h3>{t("guide.blocks.controls")}</h3>
        <p>{dim.controls}</p>
      </div>

      <div className="guide-block">
        <h3>{t("guide.blocks.options")}</h3>
        <div className="guide-option-stack">
          {dim.options.map((opt, i) => (
            <article key={i} className="guide-option-row" data-lane={i % 5}>
              <div className="guide-option-id">
                <code>{opt.value}</code>
                <span>{opt.label}</span>
              </div>
              <p>{opt.effect}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="guide-block">
        <h3>{t("guide.blocks.path")}</h3>
        <ol className="guide-path-list">
          {dim.path.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </div>

      <div className="guide-split">
        <div className="guide-split-card" data-side="lc">
          <h3>LangChain</h3>
          <p>{dim.langChain}</p>
        </div>
        <div className="guide-split-card" data-side="lg">
          <h3>LangGraph</h3>
          <p>{dim.langGraph}</p>
        </div>
      </div>

      <div className="guide-block">
        <h3>{t("guide.blocks.codeEntry")}</h3>
        <ul className="guide-code-list">
          {dim.modules.map((m, i) => (
            <li key={i}>
              <code>{m}</code>
            </li>
          ))}
        </ul>
      </div>

      <div className="guide-block">
        <h3>{t("guide.blocks.baselineTip")}</h3>
        <p>{dim.baselineTip}</p>
      </div>

      {dim.caveats.length > 0 && (
        <div className="guide-callout" data-tone="warn">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <ul>
            {dim.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <Link href={`/arena?dimension=${dim.id}`} className="btn-ghost guide-dim-cta">
        {t("guide.dim.cta", { label: dim.label })}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

/** Sidebar TOC: scroll-highlight state is self-contained, so scrolling re-renders only this component, not the whole static page tree. */
function GuideToc() {
  const t = useT();
  const { tocGroups } = useGuideContent();
  const [activeId, setActiveId] = useState(() => tocGroups[0]?.items[0]?.id ?? "");

  useEffect(() => {
    const ids = tocGroups.flatMap((g) => g.items.map((i) => i.id));
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0.15, 0.4, 0.7] },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [tocGroups]);

  return (
    <nav className="guide-toc" aria-label={t("guide.toc.aria")}>
      {tocGroups.map((group) => (
        <div key={group.title} className="guide-toc-group">
          <p className="eyebrow">{group.title}</p>
          <ul>
            {group.items.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  data-active={activeId === item.id}
                  aria-current={activeId === item.id ? "true" : undefined}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Guide route: capability docs, toolset presets, and dimension reference. */
export default function GuidePage() {
  const t = useT();
  const content = useGuideContent();

  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>(".guide-reveal");
    const showAll = () => nodes.forEach((n) => n.classList.add("is-visible"));
    try {
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
            }
          }
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
      );
      nodes.forEach((n) => io.observe(n));
      return () => io.disconnect();
    } catch {
      // On progressive-enhancement failure (e.g. no IntersectionObserver), everything is directly visible;
      // content must never be left at .guide-reveal's opacity:0 (fail-visible).
      showAll();
    }
  }, []);

  return (
    <div className="guide-page">
      <header className="guide-hero guide-reveal is-visible">
        <div className="guide-hero-grid">
          <div className="guide-hero-copy">
            <p className="eyebrow">{content.hero.eyebrow}</p>
            <h1 className="page-title guide-hero-title">
              <span className="guide-hero-title-accent">{content.hero.title}</span>
            </h1>
            <p className="guide-hero-lead">{content.hero.lead}</p>
            <div className="guide-hero-actions">
              {content.hero.actions.map((action) => {
                const Icon = HERO_ACTION_ICONS[action.icon];
                return (
                  <Link
                    key={action.href}
                    href={action.href}
                    className={action.variant === "primary" ? "btn-primary" : "btn-ghost"}
                  >
                    {action.variant === "primary" && <Icon className="h-4 w-4" />}
                    {action.label}
                    {action.variant === "ghost" && <Icon className="h-4 w-4" />}
                  </Link>
                );
              })}
            </div>
            <ul className="guide-hero-pillars" aria-label={t("guide.hero.pillarsAria")}>
              {content.hero.pillars.map((pillar, i) => (
                <li key={i} data-lane={i % 4}>
                  <span className="guide-hero-pillar-kicker">{pillar.kicker}</span>
                  {pillar.text}
                </li>
              ))}
            </ul>
          </div>

          <aside className="guide-hero-aside" aria-label={t("guide.hero.asideAria")}>
            <div className="guide-hero-metrics">
              {content.hero.metrics.map((metric, i) => (
                <div key={metric.label} className="guide-hero-metric" data-lane={i % 4}>
                  <span className="guide-hero-metric-value">{metric.count}</span>
                  <span className="guide-hero-metric-label">{metric.label}</span>
                </div>
              ))}
            </div>

            <div className="guide-hero-read">
              <div className="guide-hero-read-head">
                <p className="eyebrow">{t("guide.hero.readEyebrow")}</p>
                <span className="guide-hero-read-hint">{t("guide.hero.readHint")}</span>
              </div>
              <nav className="guide-hero-read-grid" aria-label={t("guide.hero.readNavAria")}>
                {content.overviewSections
                  .filter((s) => s.group === "overview")
                  .map((section, idx) => (
                    <a
                      key={section.id}
                      href={`#${section.id}`}
                      className="guide-hero-read-link"
                      data-lane={idx % 4}
                    >
                      <span className="guide-hero-read-idx" aria-hidden>
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span className="guide-hero-read-label">{section.title}</span>
                    </a>
                  ))}
              </nav>
              <div className="guide-hero-dim-row" aria-label={t("guide.hero.dimRowAria")}>
                {content.dimensions.slice(0, content.hero.dimChipLimit).map((d, idx) => (
                  <a
                    key={d.id}
                    href={`#${d.id}`}
                    className="guide-hero-dim-chip"
                    data-lane={idx % 4}
                  >
                    {d.label}
                  </a>
                ))}
                {content.dimensions.length > content.hero.dimChipLimit && (
                  <span className="guide-hero-dim-more">
                    +{content.dimensions.length - content.hero.dimChipLimit}
                  </span>
                )}
              </div>
            </div>
          </aside>
        </div>
      </header>

      <div className="guide-layout">
        {/* The sticky TOC omits guide-reveal: transform breaks sticky positioning */}
        <GuideToc />

        <div className="guide-main">
          {content.overviewSections.map((section, i) => (
            <Reveal key={section.id} delay={Math.min(i * 20, 100)}>
              <GuideSectionView section={section} />
            </Reveal>
          ))}

          <div className="guide-dim-index guide-reveal">
            <p className="eyebrow">{content.dimIndexDoc.eyebrow}</p>
            <p className="guide-dim-index-note">{content.dimIndexDoc.note}</p>
          </div>

          {content.dimensions.map((dim, i) => (
            <DimSection key={dim.id} dim={dim} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
