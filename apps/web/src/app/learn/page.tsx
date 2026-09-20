/**
 * @file learn/page
 * @description The /learn route page.
 *
 * Responsibilities:
 * - Render long-form content from the locale-selected learn module
 * - Take fixed schema labels from the learn catalogs via useT
 */

"use client";

import Link from "next/link";
import { ArrowRight, Compass, Flag, Lightbulb, Route } from "lucide-react";
import { selectLearnContent } from "@/i18n/content/learn";
import { useLocale, useT } from "@/i18n/useT";

/** The view carries no content-varying copy (content comes from the locale-selected i18n content module); fixed schema labels come from the catalogs via useT. */

/** Learn route: guided product tour content. */
export default function LearnPage() {
  const t = useT();
  const locale = useLocale();
  const { page, weekPlan } = selectLearnContent(locale);

  return (
    <div className="mx-auto max-w-5xl space-y-8 learn-page">
      <div>
        <p className="eyebrow mb-2">{page.eyebrow}</p>
        <h1 className="page-title text-3xl">{page.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-2xl">{page.intro}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 stagger-children">
        {weekPlan.map((step) => (
          <section
            key={step.week}
            className="panel-surface panel-lift learn-week-card flex flex-col gap-3 p-5"
            data-lane={(step.week - 1) % 4}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  className="learn-week-badge font-mono text-[10px] font-semibold border border-current rounded-md px-1.5 py-0.5"
                  aria-hidden
                >
                  W{step.week}
                </span>
                <h2 className="font-semibold text-sm">{step.title}</h2>
              </div>
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground shrink-0">
                <Compass className="h-3 w-3" />
                {step.dimension}
              </span>
            </div>

            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              {step.goal}
            </p>

            <ul className="space-y-1.5 text-xs">
              {step.items.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" aria-hidden />
                  <span className="text-muted-foreground leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-2">
              <Link
                href={step.href}
                className="btn-primary !w-full justify-center"
                aria-label={t("learn.cta.stepAria", { week: step.week, title: step.title })}
              >
                {t("learn.cta.step")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </section>
        ))}
      </div>

      <section className="panel-surface p-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <Route className="mt-0.5 h-4 w-4 text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium">{page.advanced.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{page.advanced.body}</p>
          </div>
        </div>
        <Link href={page.advanced.link.href} className="btn-ghost shrink-0">
          <Lightbulb className="h-4 w-4" />
          {page.advanced.link.label}
        </Link>
      </section>
    </div>
  );
}
