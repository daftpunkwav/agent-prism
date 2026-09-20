/**
 * @file catalogs/zh-CN/projects
 * @description zh-CN copy for the /projects route (source of truth).
 *
 * Responsibilities:
 * - Define the projects namespace's keys and Chinese copy
 *
 * Pure data only; the en overlay must stay structurally identical.
 */

export const projects = {
  title: "项目",
  desc: "从 Arena 运行中创建项目，保存 Agent 工作空间和对比结果",
  loading: "加载项目…",
  newExperiment: "新实验",
  empty: {
    title: "还没有项目",
    desc: "进入 Arena 运行实验后，在对比报告里创建项目，即可在此归档结果与工作空间",
    cta: "开始实验",
  },
  deleteConfirm: "确定删除此项目？",
  deleteAria: "删除项目 {name}",
  resultCount: "{count} 个结果",
};
