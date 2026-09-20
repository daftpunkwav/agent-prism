/**
 * @file tools/todo
 * @description Builtin todo_write tool: workspace-scoped task planning list.
 *
 * Responsibilities:
 * - Declare the tool's JSON schema (whole-list replacement, DSH todo_write semantics)
 * - Persist the list to .agent-todos.json so it survives turns and restarts
 * - Validate items loudly (fail-closed with a message, never silently flatten)
 *
 * Localized port of the DSH tool-todo idea without the cordis/session-projection
 * machinery: one workspace owns one list, each call replaces the whole list.
 * Parallel in_progress items are allowed (arena columns run sequential work, but
 * rejecting a model's parallel marking would break runs for no local gain).
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";

import { boundText } from "./spill.js";
import { asWorkspaceView } from "./workspace-view.js";

export const TODO_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      description: "The ENTIRE task list; replaces the previous list (no partial updates)",
      items: {
        type: "object",
        properties: {
          content: { type: "string", description: "Concrete step description" },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed"],
            description: "pending (not started), in_progress (worked on now), completed (done)",
          },
        },
        required: ["content", "status"],
        additionalProperties: false,
      },
    },
  },
  required: ["todos"],
  additionalProperties: false,
};

/** Storage file inside the workspace root (dotfile: stays out of the model's way). */
export const TODO_STORE_FILE = ".agent-todos.json";

/** Caps: a planning list is small by design; oversized input is rejected, not truncated. */
const MAX_TODOS = 50;
const MAX_CONTENT_CHARS = 500;

const STATUSES = ["pending", "in_progress", "completed"] as const;
type TodoStatus = (typeof STATUSES)[number];

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function render(items: TodoItem[]): string {
  if (items.length === 0) return "Todos: (empty list)";
  const done = items.filter((item) => item.status === "completed").length;
  const lines = items.map((item) => {
    const mark = item.status === "completed" ? "[x]" : item.status === "in_progress" ? "[=]" : "[ ]";
    return `${mark} ${item.content}`;
  });
  return `Todos (${done}/${items.length} completed):\n${lines.join("\n")}`;
}

async function executeTodo(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  try {
    const view = asWorkspaceView(workspace);
    if (!Array.isArray(args.todos)) {
      return { result: "Error: todos must be an array of {content, status} items", fileDiff: null, ok: false, code: "workspace_error" };
    }
    const raw = args.todos as unknown[];
    if (raw.length > MAX_TODOS) {
      return { result: `Error: too many todos (${raw.length} > ${MAX_TODOS}); split the work first`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    const items: TodoItem[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
      if (!isRecord(entry)) {
        return { result: "Error: every todo must be an object with content and status", fileDiff: null, ok: false, code: "workspace_error" };
      }
      const content = typeof entry.content === "string" ? entry.content.trim() : "";
      if (content === "") {
        return { result: "Error: todo content must be a non-empty string", fileDiff: null, ok: false, code: "workspace_error" };
      }
      if (content.length > MAX_CONTENT_CHARS) {
        return { result: `Error: todo content exceeds ${MAX_CONTENT_CHARS} chars: ${content.slice(0, 60)}...`, fileDiff: null, ok: false, code: "workspace_error" };
      }
      // Status is case-tolerant (PENDING/In_Progress/...) so a cased call still binds.
      const status = typeof entry.status === "string" ? entry.status.trim().toLowerCase() : "";
      if (!(STATUSES as readonly string[]).includes(status)) {
        return { result: `Error: todo status must be one of ${STATUSES.join(", ")}`, fileDiff: null, ok: false, code: "workspace_error" };
      }
      if (seen.has(content)) {
        return { result: `Error: duplicate todo: ${JSON.stringify(content)}`, fileDiff: null, ok: false, code: "workspace_error" };
      }
      seen.add(content);
      items.push({ content, status: status as TodoStatus });
    }
    view.fs.writeFile(TODO_STORE_FILE, `${JSON.stringify(items, null, 2)}\n`);
    return { result: boundText(workspace, "todo_write", render(items)), fileDiff: null, ok: true };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
}

/** Builtin todo_write tool definition. */
export const todoTool: ToolDefinition = {
  name: "todo_write",
  description:
    "Record and update a structured task list for the current work. Send the ENTIRE list every call — it REPLACES the previous list. Plan multi-step work before starting; mark a todo completed the moment it is done. Skip for trivial single-step tasks.",
  jsonSchema: TODO_JSON_SCHEMA,
  mutatesWorkspace: true,
  execute: executeTodo,
};
