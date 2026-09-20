/**
 * @file catalogs/zh-CN/errors
 * @description zh-CN copy for the error boundaries (source of truth).
 *
 * Responsibilities:
 * - Define the errors namespace's keys and Chinese copy
 *
 * Pure data only; the en overlay must stay structurally identical.
 */

export const errors = {
  route: {
    title: "出错了",
    body: "页面渲染时发生错误。你可以重试，或返回首页。",
    digest: "错误编号：{digest}",
    retry: "重试",
    backHome: "返回首页",
  },
  global: {
    title: "出错了",
    body: "应用发生严重错误。请重试或刷新页面。",
    digest: "错误编号：{digest}",
    retry: "重试",
  },
};
