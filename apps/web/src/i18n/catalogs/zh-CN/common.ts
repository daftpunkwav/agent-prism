/**
 * @file catalogs/zh-CN/common
 * @description zh-CN copy for cross-cutting copy (source of truth).
 *
 * Responsibilities:
 * - Define the common namespace's keys and Chinese copy
 *
 * Pure data only; the en overlay must stay structurally identical.
 */

export const common = {
  ok: "确定",
  cancel: "取消",
  loading: "加载中…",
  copy: "复制",
  error: "错误",
  // ask_user modal (shared by Arena and Builder)
  askTitle: "Agent 提问",
  askWaiting: "回答后运行才会继续；超时未答将按无应答继续运行",
  askFrom: "来自",
  askAnswerPlaceholder: "输入回答…",
  askSend: "回答",
  askSkip: "跳过",
  askAnswered: "已回答",
  askSubmitError: "回答发送失败",
};
