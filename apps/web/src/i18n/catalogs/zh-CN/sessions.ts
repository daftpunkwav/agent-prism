/**
 * @file catalogs/zh-CN/sessions
 * @description zh-CN copy for the /sessions route (source of truth).
 *
 * Responsibilities:
 * - Define the sessions namespace's keys and Chinese copy
 *
 * Pure data only; the en overlay must stay structurally identical.
 */

export const sessions = {
  title: "运行记录",
  desc: "Arena、Agent 与构建器执行的持久账本：状态、摘要与里程碑",
  loading: "加载运行记录…",
  empty: {
    title: "还没有运行记录",
    desc: "进入 Arena 运行实验，完成后即可在此查看每轮的状态与摘要",
    cta: "开始实验",
  },
  kind: {
    arena: "Arena",
    agent: "Agent",
    builder: "构建器",
  },
  status: {
    active: "进行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  },
  entries: "{count} 条里程碑",
  loadingEntries: "加载里程碑…",
  noEntries: "暂无里程碑",
  noSummary: "暂无摘要",
  newExperiment: "新建实验",
  filterKindAria: "按类型筛选",
  filterStatusAria: "按状态筛选",
  filterAllKinds: "全部类型",
  filterAllStatuses: "全部状态",
  statsLine: "共 {total} 条 · 进行中 {active} · 已完成 {completed} · 失败 {failed} · 已取消 {cancelled}",
  exportAction: "导出",
  exportAria: "导出运行记录 {name}",
  deleteConfirm: "确定删除这条运行记录？",
  deleteAria: "删除运行记录 {name}",
  showEntries: "展开里程碑",
  hideEntries: "收起里程碑",
};
