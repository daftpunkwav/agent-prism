/**
 * @file catalogs/en/sessions
 * @description English copy for the /sessions route.
 *
 * Responsibilities:
 * - Mirror the zh-CN sessions namespace key-for-key
 *
 * Structure is compile-enforced via MessageCatalog against the zh-CN source.
 */

export const sessions = {
  title: "Run history",
  desc: "Durable ledger of Arena, Agent, and Builder executions: status, summaries, milestones",
  loading: "Loading run history…",
  empty: {
    title: "No runs yet",
    desc: "Run an experiment in Arena; each settled run lands here with status and summary",
    cta: "Start an experiment",
  },
  kind: {
    arena: "Arena",
    agent: "Agent",
    builder: "Builder",
  },
  status: {
    active: "Active",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  },
  entries: "{count} milestones",
  loadingEntries: "Loading milestones…",
  noEntries: "No milestones yet",
  noSummary: "No summary yet",
  newExperiment: "New experiment",
  filterKindAria: "Filter by kind",
  filterStatusAria: "Filter by status",
  filterAllKinds: "All kinds",
  filterAllStatuses: "All statuses",
  statsLine: "{total} runs · {active} active · {completed} done · {failed} failed · {cancelled} cancelled",
  exportAction: "Export",
  exportAria: "Export run record {name}",
  deleteConfirm: "Delete this run record?",
  deleteAria: "Delete run record {name}",
  showEntries: "Show milestones",
  hideEntries: "Hide milestones",
};
