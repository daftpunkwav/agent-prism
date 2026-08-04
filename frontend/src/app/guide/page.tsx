"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, FlaskConical, ShieldAlert } from "lucide-react";
import {
  BASELINE_RULES,
  COMPARE_FORMS,
  DIMENSIONS,
  FIELD_MATRIX,
  HONESTY,
  MULTI_TURN_DOC,
  PIPELINE_STAGES,
  REALITY_LABEL,
  TOC_GROUPS,
  TOOLSET_TABLE,
  type DimDoc,
  type Reality,
} from "./guideData";

function RealityBadge({ reality }: { reality: Reality }) {
  return (
    <span className="guide-badge" data-reality={reality}>
      {REALITY_LABEL[reality]}
    </span>
  );
}

function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={"guide-reveal " + className}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

function DimSection({ dim, index }: { dim: DimDoc; index: number }) {
  return (
    <section
      id={dim.id}
      className="guide-section guide-dim guide-reveal"
      data-lane={index % 5}
      style={{ "--reveal-delay": `${Math.min(index * 40, 200)}ms` } as CSSProperties}
    >
      <div className="guide-section-rail" aria-hidden />
      <header className="guide-dim-head">
        <div className="guide-dim-titles">
          <p className="eyebrow">{dim.id}</p>
          <h2>{dim.label}</h2>
          <p className="guide-dim-summary">{dim.summary}</p>
        </div>
        <div className="guide-dim-meta">
          <RealityBadge reality={dim.reality} />
          <code className="guide-field-chip">{dim.field}</code>
        </div>
      </header>

      <div className="guide-block">
        <h3>控制什么</h3>
        <p>{dim.controls}</p>
      </div>

      <div className="guide-block">
        <h3>选项一览</h3>
        <div className="guide-option-stack">
          {dim.options.map((opt, i) => (
            <article key={opt.value} className="guide-option-row" data-lane={i % 5}>
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
        <h3>执行路径</h3>
        <ol className="guide-path-list">
          {dim.path.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </div>

      <div className="guide-split">
        <div className="guide-split-card" data-side="lc">
          <h3>LangChain</h3>
          <p>{dim.lc}</p>
        </div>
        <div className="guide-split-card" data-side="lg">
          <h3>LangGraph</h3>
          <p>{dim.lg}</p>
        </div>
      </div>

      <div className="guide-block">
        <h3>代码入口</h3>
        <ul className="guide-code-list">
          {dim.modules.map((m) => (
            <li key={m}>
              <code>{m}</code>
            </li>
          ))}
        </ul>
      </div>

      <div className="guide-block">
        <h3>基线建议</h3>
        <p>{dim.baselineTip}</p>
      </div>

      {dim.caveats.length > 0 && (
        <div className="guide-callout" data-tone="warn">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <ul>
            {dim.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <Link href={`/arena?dimension=${dim.id}`} className="btn-ghost guide-dim-cta">
        在 Arena 对比「{dim.label}」
        <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

export default function GuidePage() {
  const [activeId, setActiveId] = useState("method");

  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>(".guide-reveal");
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
  }, []);

  useEffect(() => {
    const ids = TOC_GROUPS.flatMap((g) => g.items.map((i) => i.id));
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
  }, []);

  return (
    <div className="guide-page">
      <header className="guide-hero guide-reveal is-visible">
        <div className="guide-hero-slit" aria-hidden />
        <div className="guide-hero-grid">
          <div className="guide-hero-copy">
            <p className="eyebrow">OPTICAL BENCH · REFERENCE</p>
            <h1 className="page-title guide-hero-title">
              <span className="guide-hero-title-accent">维度与基线说明</span>
            </h1>
            <p className="guide-hero-lead">
              控制变量法的结构化参考：字段如何映射、基线如何锁定、十个对比维在
              LangChain / LangGraph 上是否真实生效，以及多轮对话如何按轮次分段对比。
            </p>
            <div className="guide-hero-actions">
              <Link href="/arena" className="btn-primary">
                <FlaskConical className="h-4 w-4" />
                打开 Arena
              </Link>
              <Link href="/learn" className="btn-ghost">
                学习路径
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <ul className="guide-hero-pillars" aria-label="阅读要点">
              <li data-lane="0">
                <span className="guide-hero-pillar-kicker">管线</span>
                解码 · 接入点分层对照
              </li>
              <li data-lane="1">
                <span className="guide-hero-pillar-kicker">基线</span>
                锁定当前对比维以外的字段
              </li>
              <li data-lane="2">
                <span className="guide-hero-pillar-kicker">多轮</span>
                共享 messages，按 turn 分段
              </li>
              <li data-lane="3">
                <span className="guide-hero-pillar-kicker">Trace</span>
                列对齐对比 Thought / Action
              </li>
            </ul>
          </div>

          <aside className="guide-hero-aside" aria-label="速览与导读">
            <div className="guide-hero-metrics">
              <div className="guide-hero-metric" data-lane="0">
                <span className="guide-hero-metric-value">{DIMENSIONS.length}</span>
                <span className="guide-hero-metric-label">对比维度</span>
              </div>
              <div className="guide-hero-metric" data-lane="1">
                <span className="guide-hero-metric-value">{FIELD_MATRIX.length}</span>
                <span className="guide-hero-metric-label">字段映射</span>
              </div>
              <div className="guide-hero-metric" data-lane="2">
                <span className="guide-hero-metric-value">{TOOLSET_TABLE.length}</span>
                <span className="guide-hero-metric-label">工具集预设</span>
              </div>
            </div>

            <div className="guide-hero-read">
              <div className="guide-hero-read-head">
                <p className="eyebrow">本页导读</p>
                <span className="guide-hero-read-hint">跳转到章节</span>
              </div>
              <nav className="guide-hero-read-grid" aria-label="章节快捷入口">
                {(TOC_GROUPS[0]?.items ?? []).map((item, idx) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="guide-hero-read-link"
                    data-lane={idx % 4}
                  >
                    <span className="guide-hero-read-idx" aria-hidden>
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <span className="guide-hero-read-label">{item.label}</span>
                  </a>
                ))}
              </nav>
              <div className="guide-hero-dim-row" aria-label="对比维度一览">
                {DIMENSIONS.slice(0, 6).map((d, idx) => (
                  <a
                    key={d.id}
                    href={`#${d.id}`}
                    className="guide-hero-dim-chip"
                    data-lane={idx % 4}
                  >
                    {d.label}
                  </a>
                ))}
                {DIMENSIONS.length > 6 && (
                  <span className="guide-hero-dim-more">+{DIMENSIONS.length - 6}</span>
                )}
              </div>
            </div>
          </aside>
        </div>
      </header>

      <div className="guide-layout">
        {/* sticky TOC 不加 guide-reveal：transform 会破坏 sticky */}
        <nav className="guide-toc" aria-label="本页目录">
          {TOC_GROUPS.map((group) => (
            <div key={group.title} className="guide-toc-group">
              <p className="eyebrow">{group.title}</p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <a href={`#${item.id}`} data-active={activeId === item.id}>
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="guide-main">
          <Reveal>
            <section id="method" className="guide-section">
              <div className="guide-section-rail" aria-hidden />
              <h2>控制变量法</h2>
              <p>
                一次实验只让<strong>一个字段</strong>在各列之间变化（对比维），其余字段取同一套基线。
                对比报告里的耗时、Token、工具次数、判分，才能归因到正在测量的那一维。
              </p>
              <div className="guide-formula" aria-label="控制变量公式">
                <div className="guide-formula-card" data-lane="0">
                  <span className="eyebrow">对比维</span>
                  <p>
                    列间变化
                    <br />
                    <code>selections[] → field</code>
                  </p>
                </div>
                <span className="guide-formula-plus" aria-hidden>
                  +
                </span>
                <div className="guide-formula-card" data-lane="1">
                  <span className="eyebrow">基线</span>
                  <p>
                    列间固定
                    <br />
                    <code>baseline → 其它字段</code>
                  </p>
                </div>
                <span className="guide-formula-plus" aria-hidden>
                  →
                </span>
                <div className="guide-formula-card" data-lane="2">
                  <span className="eyebrow">输出</span>
                  <p>
                    多列 PipelineConfig
                    <br />
                    <code>Adapter.run × N</code>
                  </p>
                </div>
              </div>
              <p className="guide-note">
                路由：<code>DimensionRouter.route(dimension, selections, baseline)</code> ·
                映射：<code>DIMENSION_FIELD</code>
              </p>
            </section>
          </Reveal>

          <Reveal delay={20}>
            <section id="multi-turn" className="guide-section">
              <div className="guide-section-rail" aria-hidden />
              <h2>{MULTI_TURN_DOC.title}与按轮对比</h2>
              <p>{MULTI_TURN_DOC.summary}</p>

              <div className="guide-block">
                <h3>运行机制</h3>
                <ol className="guide-path-list">
                  {MULTI_TURN_DOC.mechanics.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
              </div>

              <div className="guide-block">
                <h3>约束与边界</h3>
                <ul className="guide-code-list">
                  {MULTI_TURN_DOC.limits.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>

              <div className="guide-rule-grid">
                {COMPARE_FORMS.map((row, i) => (
                  <article key={row.title} className="guide-rule-card" data-lane={i % 5}>
                    <h3>{row.title}</h3>
                    <p>{row.body}</p>
                  </article>
                ))}
              </div>

              <div className="guide-block">
                <h3>代码入口</h3>
                <ul className="guide-code-list">
                  {MULTI_TURN_DOC.modules.map((m) => (
                    <li key={m}>
                      <code>{m}</code>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </Reveal>

          <Reveal delay={40}>
            <section id="field-matrix" className="guide-section">
              <div className="guide-section-rail" aria-hidden />
              <h2>字段总表</h2>
              <p>十个对比维与 PipelineConfig 字段一一对应；也可全部出现在基线面板中。多轮历史走 ArenaRunRequest.messages，不属于对比维。</p>
              <div className="guide-ledger" role="table" aria-label="字段总表">
                <div className="guide-ledger-head" role="row">
                  <span role="columnheader">维度</span>
                  <span role="columnheader">配置字段</span>
                  <span role="columnheader">类型</span>
                  <span role="columnheader">默认</span>
                  <span role="columnheader">锁定</span>
                </div>
                {FIELD_MATRIX.map((row, i) => (
                  <a
                    key={row.dimension}
                    href={`#${row.dimension}`}
                    className="guide-ledger-row"
                    role="row"
                    data-lane={i % 5}
                  >
                    <span className="guide-ledger-dim" role="cell">
                      <code>{row.dimension}</code>
                    </span>
                    <span role="cell">
                      <code>{row.field}</code>
                    </span>
                    <span className="guide-ledger-muted" role="cell">
                      {row.type}
                    </span>
                    <span className="guide-ledger-muted" role="cell">
                      {row.defaultValue}
                    </span>
                    <span className="guide-ledger-muted" role="cell">
                      {row.lockedWhen}
                    </span>
                  </a>
                ))}
              </div>
            </section>
          </Reveal>

          <Reveal delay={60}>
            <section id="baseline" className="guide-section">
              <div className="guide-section-rail" aria-hidden />
              <h2>基线机制</h2>
              <p>
                基线是对非对比维字段的覆盖写入。前端锁定与后端校验必须一致，非法取值直接失败。
              </p>
              <div className="guide-rule-grid">
                {BASELINE_RULES.map((r, i) => (
                  <article key={r.title} className="guide-rule-card" data-lane={i % 5}>
                    <h3>{r.title}</h3>
                    <p>{r.body}</p>
                  </article>
                ))}
              </div>
              <p className="guide-note">
                <code>BaselineOverrides</code> → <code>_resolve_baseline_overrides</code> →{" "}
                <code>_base(**overrides)</code>
              </p>
            </section>
          </Reveal>

          <Reveal delay={80}>
            <section id="pipeline" className="guide-section">
              <div className="guide-section-rail" aria-hidden />
              <h2>单次运行链路</h2>
              <ol className="guide-stages">
                {PIPELINE_STAGES.map((stage, i) => (
                  <li key={stage.title} data-lane={i % 5}>
                    <span className="guide-stage-index" aria-hidden>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3>{stage.title}</h3>
                      <p>{stage.detail}</p>
                      <p className="guide-stage-mod">
                        <code>{stage.module}</code>
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </Reveal>

          <Reveal delay={100}>
            <section id="toolsets" className="guide-section">
              <div className="guide-section-rail" aria-hidden />
              <h2>工具集明细</h2>
              <p>
                <code>toolset</code> 经 <code>select_tools</code> 过滤后真实{" "}
                <code>bind_tools</code> / <code>create_agent</code>——以绑定集合为准。
              </p>
              <div className="guide-toolset-grid">
                {TOOLSET_TABLE.map((row, i) => (
                  <article key={row.id} className="guide-toolset-card" data-lane={i % 5}>
                    <div className="guide-toolset-top">
                      <code>{row.id}</code>
                      <span>{row.label}</span>
                    </div>
                    <p>{row.tools}</p>
                  </article>
                ))}
              </div>
            </section>
          </Reveal>

          <div className="guide-dim-index guide-reveal">
            <p className="eyebrow">对比维度详情</p>
            <p className="guide-dim-index-note">
              统一结构：控制什么 → 选项 → 路径 → LC/LG → 代码 → 基线建议 → 边界
            </p>
          </div>

          {DIMENSIONS.map((dim, i) => (
            <DimSection key={dim.id} dim={dim} index={i} />
          ))}

          <Reveal>
            <section id="honesty" className="guide-section">
              <div className="guide-section-rail" aria-hidden />
              <h2>诚实边界</h2>
              <p>刻意不夸大，避免把「文案差异」误读成「编排差异」。</p>
              <div className="guide-rule-grid">
                {HONESTY.map((row, i) => (
                  <article key={row.title} className="guide-rule-card" data-lane={i % 5}>
                    <h3>{row.title}</h3>
                    <p>{row.body}</p>
                  </article>
                ))}
              </div>
            </section>
          </Reveal>
        </div>
      </div>
    </div>
  );
}
