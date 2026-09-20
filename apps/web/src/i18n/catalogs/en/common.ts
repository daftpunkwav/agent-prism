/**
 * @file catalogs/en/common
 * @description English copy for cross-cutting copy.
 *
 * Responsibilities:
 * - Mirror the zh-CN common namespace key-for-key
 *
 * Structure is compile-enforced via MessageCatalog against the zh-CN source.
 */

export const common = {
  ok: "OK",
  cancel: "Cancel",
  loading: "Loading…",
  copy: "Copy",
  error: "Error",
  // ask_user modal (shared by Arena and Builder)
  askTitle: "Agent question",
  askWaiting: "The run resumes on your answer; on timeout it continues without one",
  askFrom: "From",
  askAnswerPlaceholder: "Type an answer…",
  askSend: "Answer",
  askSkip: "Skip",
  askAnswered: "Answered",
  askSubmitError: "Failed to send the answer",
};
