/**
 * @file catalogs/en/errors
 * @description English copy for the error boundaries.
 *
 * Responsibilities:
 * - Mirror the zh-CN errors namespace key-for-key
 *
 * Structure is compile-enforced via MessageCatalog against the zh-CN source.
 */

export const errors = {
  route: {
    title: "Something went wrong",
    body: "An error occurred while rendering this page. You can retry or go back to the home page.",
    digest: "Error digest: {digest}",
    retry: "Retry",
    backHome: "Back to home",
  },
  global: {
    title: "Something went wrong",
    body: "A critical error occurred. Please retry or refresh the page.",
    digest: "Error digest: {digest}",
    retry: "Retry",
  },
};
