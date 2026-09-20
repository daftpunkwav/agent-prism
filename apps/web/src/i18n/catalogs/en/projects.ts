/**
 * @file catalogs/en/projects
 * @description English copy for the /projects route.
 *
 * Responsibilities:
 * - Mirror the zh-CN projects namespace key-for-key
 *
 * Structure is compile-enforced via MessageCatalog against the zh-CN source.
 */

export const projects = {
  title: "Projects",
  desc: "Create projects from Arena runs to save Agent workspaces and comparison results",
  loading: "Loading projects…",
  newExperiment: "New experiment",
  empty: {
    title: "No projects yet",
    desc: "Run an experiment in Arena, then create a project from the comparison report to archive its results and workspace here",
    cta: "Start an experiment",
  },
  deleteConfirm: "Delete this project?",
  deleteAria: "Delete project {name}",
  resultCount: "{count} results",
};
