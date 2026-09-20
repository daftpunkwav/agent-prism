/**
 * @file catalogs/zh-CN/guide
 * @description zh-CN copy for the /guide view (source of truth).
 *
 * Responsibilities:
 * - Define the guide namespace's keys and Chinese copy
 *
 * Pure data only; the en overlay must stay structurally identical.
 */

export const guide = {
  table: {
    aria: "字段总表",
    dimension: "维度",
    field: "配置字段",
    type: "类型",
    defaultValue: "默认",
    locked: "锁定",
  },
  blocks: {
    formulaAria: "控制变量公式",
    controls: "控制什么",
    options: "选项一览",
    path: "执行路径",
    codeEntry: "代码入口",
    baselineTip: "基线建议",
  },
  hero: {
    pillarsAria: "阅读要点",
    asideAria: "速览与导读",
    readEyebrow: "本页导读",
    readHint: "跳转到章节",
    readNavAria: "章节快捷入口",
    dimRowAria: "对比维度一览",
  },
  toc: {
    aria: "本页目录",
  },
  dim: {
    cta: "在 Arena 对比「{label}」",
  },
};
