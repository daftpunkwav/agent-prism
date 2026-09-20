/**
 * @file catalogs/en/guide
 * @description English copy for the /guide view.
 *
 * Responsibilities:
 * - Mirror the zh-CN guide namespace key-for-key
 *
 * Structure is compile-enforced via MessageCatalog against the zh-CN source.
 */

export const guide = {
  table: {
    aria: "Field matrix",
    dimension: "Dimension",
    field: "Config field",
    type: "Type",
    defaultValue: "Default",
    locked: "Locked",
  },
  blocks: {
    formulaAria: "Control-variable formula",
    controls: "What it controls",
    options: "Options",
    path: "Execution path",
    codeEntry: "Code entry points",
    baselineTip: "Baseline tips",
  },
  hero: {
    pillarsAria: "Key points",
    asideAria: "Quick overview and reading guide",
    readEyebrow: "Reading guide",
    readHint: "Jump to a section",
    readNavAria: "Quick section links",
    dimRowAria: "Comparison dimensions at a glance",
  },
  toc: {
    aria: "On this page",
  },
  dim: {
    cta: "Compare \"{label}\" in Arena",
  },
};
