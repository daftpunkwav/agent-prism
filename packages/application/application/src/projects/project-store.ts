/**
 * @file project-store
 * @description Project archives built from comparison-run results.
 *
 * Responsibilities:
 * - Create archives with workspace file snapshots
 * - Enforce count and size budgets on the archive set
 * - Roll back in-memory state when disk writes fail
 */

import { ProjectSchema, type Clock, type IdGenerator, type PipelineRunResult, type Project, type ProjectCreate } from "@agentprism/contracts";
import type { JsonFile } from "@agentprism/persistence";
import type { WorkspaceRegistry } from "@agentprism/runtime";
import { AppError } from "../errors.js";

export interface ProjectStoreOptions {
  file: JsonFile;
  workspaceRegistry: WorkspaceRegistry;
  clock: Clock;
  idGenerator: IdGenerator;
  /** Archive count cap (default 50). */
  maxProjects?: number;
  /** Per-project snapshot char cap (default 2 000 000). */
  maxSnapshotChars?: number;
}

/** Project archive count cap (prevents unbounded growth of the in-memory Map and projects.json). */
const MAX_PROJECTS = 50;
/** Per-workspace snapshot character budget (workspace_names caps at 16, so one project can reach 16x). */
const MAX_SNAPSHOT_CHARS = 2_000_000;

function formatStamp(epochMs: number): string {
  const now = new Date(epochMs);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

/**
 * Project management: creates archives from comparison-run results (with workspace
 * file snapshots). A failed write rolls back in-memory state, avoiding a fake
 * "in memory but not on disk" success.
 */
export class ProjectStore {
  private readonly projects = new Map<string, Project>();
  private readonly file: JsonFile;
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly clock: Clock;
  private readonly idGenerator: IdGenerator;
  private readonly maxProjects: number;
  private readonly maxSnapshotChars: number;

  constructor(options: ProjectStoreOptions) {
    this.file = options.file;
    this.workspaceRegistry = options.workspaceRegistry;
    this.clock = options.clock;
    this.idGenerator = options.idGenerator;
    this.maxProjects = options.maxProjects ?? MAX_PROJECTS;
    this.maxSnapshotChars = options.maxSnapshotChars ?? MAX_SNAPSHOT_CHARS;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    // Treat a corrupted file as an empty store and leave a trace (consistent with ProviderStore's fallback):
    // a parse exception propagating from the constructor would make the whole runtime refuse to start with no self-healing path
    let data: unknown;
    try {
      data = this.file.read<Project[]>();
    } catch (error) {
      // .bak is the last successful write before corruption (external corruption bypasses atomic writes, so backups survive);
      // the write path refuses to clone a corrupt main over .bak, so manual recovery stays possible:
      // restore projects.json.bak before creating projects
      console.warn(`[projects] Archive read failed; starting with empty store (to recover, restore projects.json.bak before creating projects): ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!Array.isArray(data)) return;
    // The disk file bypasses the creation path's clamping: truncate to the cap on the read side too, so external writes cannot bypass the quota
    // Each entry must satisfy the full Project schema (not just id/created_at): a hand-edited
    // file with a wrong shape would otherwise load and break consumers downstream.
    // Malformed entries are skipped with a counted warning; unknown fields are dropped by the schema.
    let skipped = 0;
    for (const item of data.slice(0, this.maxProjects)) {
      const parsed = ProjectSchema.safeParse(item);
      if (!parsed.success) {
        skipped += 1;
        continue;
      }
      this.projects.set(parsed.data.id, parsed.data);
    }
    if (skipped > 0) {
      console.warn(`[projects] Skipped ${skipped} malformed archive entries on load`);
    }
  }

  private async save(): Promise<void> {
    await this.file.write([...this.projects.values()]);
  }

  /** Newest first by ISO timestamp (total order: equal stamps keep insertion order). */
  listProjects(): Project[] {
    return [...this.projects.values()].sort((a, b) =>
      a.created_at === b.created_at ? 0 : a.created_at < b.created_at ? 1 : -1,
    );
  }

  getProject(projectId: string): Project | undefined {
    return this.projects.get(projectId);
  }

  /** Creates a project from run results: snapshot files per workspace (bounded by count and size budgets). */
  async createFromRun(create: ProjectCreate): Promise<Project> {
    if (this.projects.size >= this.maxProjects) {
      throw AppError.badRequest(`Project archive limit reached (${this.maxProjects}); delete old projects first`);
    }
    const workspaceFiles: Record<string, Record<string, string>> = {};
    const results: PipelineRunResult[] = [];

    // pipeline_labels[i] names workspace_names[i]: the frontend sends both from the same
    // column list in order (and fillWorkspaceNames makes them identical when names are omitted).
    for (const [index, workspaceName] of create.workspace_names.entries()) {
      const workspace = this.workspaceRegistry.get(workspaceName);
      if (workspace === undefined) continue;
      const snapshot: Record<string, string> = {};
      let snapshotChars = 0;
      // The budget is enforced during the walk inside snapshotFiles; the post-hoc check below stays as a second guard.
      for (const [filePath, content] of Object.entries(await workspace.fs.snapshotFiles({ maxTotalChars: this.maxSnapshotChars }))) {
        if (snapshotChars + content.length > this.maxSnapshotChars) {
          console.warn(`[projects] Snapshot exceeded size budget; remaining files in workspace ${workspaceName} were not included`);
          break;
        }
        snapshotChars += content.length;
        snapshot[filePath] = content;
      }
      workspaceFiles[workspaceName] = snapshot;
      results.push({
        // Display label, not the disk name: the projects page renders label, so storing the
        // workspace name here would show "native-react_1700000000000_a1b2c3" instead of "native-react".
        label: create.pipeline_labels[index] ?? workspaceName,
        workspace: workspaceName,
        file_count: Object.keys(snapshot).length,
        files: Object.keys(snapshot),
      });
    }

    const project: Project = {
      id: `proj_${formatStamp(this.clock.now())}_${this.idGenerator.next().slice(0, 8)}`,
      name: create.name,
      question: create.question,
      dimension: create.dimension,
      created_at: new Date(this.clock.now()).toISOString(),
      results,
      workspace_files: workspaceFiles,
      metrics_summary: {},
    };
    this.projects.set(project.id, project);
    try {
      await this.save();
    } catch (error) {
      this.projects.delete(project.id);
      throw error;
    }
    return project;
  }

  /** Deletes a project; false when absent, restores in-memory state when the write fails. */
  async deleteProject(projectId: string): Promise<boolean> {
    const removed = this.projects.get(projectId);
    if (removed === undefined) return false;
    this.projects.delete(projectId);
    try {
      await this.save();
    } catch (error) {
      this.projects.set(projectId, removed);
      throw error;
    }
    return true;
  }
}
