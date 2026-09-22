/**
 * @file tools/ask-user
 * @description Builtin ask_user tool: blocking questions with an optional live human channel.
 *
 * Responsibilities:
 * - Declare the tool's JSON schema (questions with optional options)
 * - Headless mode (default): append questions to .agent-questions.json and defer loudly
 * - Interactive mode (liveAskUserTool): hand the batch to an attached human through the
 *   AskUserRespond port and return the answers to the model
 *
 * Both modes share one arg parser and one audit log: interactive answers are still
 * recorded to .agent-questions.json, so the operator review trail never loses entries.
 * If the human channel is ever removed, the headless definition is the fallback.
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace, AskUserReply, AskUserRespond } from "@agentprism/contracts";
import { lowerAskUserKeys, normalizeAskUserBatchArgs, normalizeAskUserOptions } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";

import { boundText } from "./spill.js";
import { asWorkspaceView } from "./workspace-view.js";

export const ASK_USER_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      description: "Blocking questions for the attached human",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Stable id echoed back in the result" },
          header: { type: "string", description: "Short heading such as Confirm or Choose Mode" },
          question: { type: "string", description: "The specific question" },
          options: {
            type: "array",
            description: 'Flat string array, e.g. ["yes", "no"]; never nest arrays',
            items: { type: "string" },
          },
          multiSelect: {
            type: "boolean",
            description:
              "Set true to let the human tick several options; the answer then arrives as the selected labels joined by \", \"",
          },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

/** Storage file inside the workspace root (dotfile: stays out of the model's way). */
export const ASK_USER_STORE_FILE = ".agent-questions.json";

/** Caps: questions are for genuine blockers, not chatter. */
const MAX_QUESTIONS_PER_CALL = 5;
const MAX_QUESTION_CHARS = 1000;
const MAX_HEADER_CHARS = 80;
const MAX_OPTIONS = 6;
const MAX_OPTION_CHARS = 120;
const MAX_STORED_RECORDS = 50;

export interface AskedQuestion {
  id: string;
  header: string;
  question: string;
  options: string[];
  multiSelect?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Shared wire example so models stop guessing the options shape (flat string array). */
const ASK_USER_FORMAT_EXAMPLE =
  'Format: {"questions": [{"id": "q1", "header": "Confirm", "question": "Proceed?", "options": ["yes", "no"]}]}. ' +
  "options is a flat array of strings (max 6); omit it for free-text questions. " +
  'With "multiSelect": true the human ticks several options and the answer arrives as those labels joined by ", ".';

/**
 * Validates and normalizes one ask_user batch.
 *
 * Case-tolerant: top-level `questions`/`QUESTIONS` and per-item
 * `id`/`ID`, `header`/`HEADER`, `question`/`QUESTION`, `options`/`OPTIONS`
 * all bind to the same fields, so a model-cased call still pops the human
 * window instead of erroring (or, worse, leaving the run waiting with no UI).
 *
 * Options-tolerant: nested arrays flatten (the observed "expected string,
 * received array at questions[0].options[0]" came from a double-wrapped
 * options list). Element/count/char rules are otherwise unchanged and still
 * fail closed with a corrective message.
 *
 * @returns Parsed questions, or an error string shaped like a tool failure.
 */
export function parseAskedQuestions(args: ToolArgs): { questions: AskedQuestion[] } | { error: string } {
  const normalizedArgs = isRecord(args)
    ? normalizeAskUserBatchArgs(args as Record<string, unknown>)
    : {};
  if (!Array.isArray(normalizedArgs.questions)) {
    return { error: "Error: questions must be a non-empty array (key: questions)" };
  }
  const raw = normalizedArgs.questions as unknown[];
  if (raw.length === 0 || raw.length > MAX_QUESTIONS_PER_CALL) {
    return { error: `Error: send 1-${MAX_QUESTIONS_PER_CALL} questions per call` };
  }
  try {
    // Interactive settle keys answers by id: duplicate ids would make the batch
    // unanswerable (and double-render modal rows), so reject them fail-closed.
    const seen = new Set<string>();
    const questions: AskedQuestion[] = raw.map((entry, index) => {
      if (!isRecord(entry)) throw new WorkspaceError("Error: every question must be an object");
      const item = lowerAskUserKeys(entry);
      const question = typeof item.question === "string" ? (item.question as string).trim() : "";
      if (question === "" || question.length > MAX_QUESTION_CHARS) {
        throw new WorkspaceError(`Error: question ${index + 1} must be 1-${MAX_QUESTION_CHARS} chars`);
      }
      const header =
        typeof item.header === "string" ? (item.header as string).trim().slice(0, MAX_HEADER_CHARS) : "";
      const id =
        typeof item.id === "string" && (item.id as string).trim() !== ""
          ? (item.id as string).trim().slice(0, 40)
          : `q${index + 1}`;
      if (seen.has(id)) {
        throw new WorkspaceError(`Error: question ids must be unique (duplicate: ${id})`);
      }
      seen.add(id);
      let options: string[] = [];
      if (item.options !== undefined) {
        const flat = normalizeAskUserOptions(item.options);
        if (!Array.isArray(flat) || flat.length > MAX_OPTIONS) {
          throw new WorkspaceError(`Error: options must be an array of at most ${MAX_OPTIONS} labels`);
        }
        options = (flat as unknown[]).map((option) => {
          const label = typeof option === "string" ? option.trim() : "";
          if (label === "" || label.length > MAX_OPTION_CHARS) {
            throw new WorkspaceError("Error: every option must be a non-empty label");
          }
          return label;
        });
      }
      return { id, header, question, options, ...(item.multiselect === true ? { multiSelect: true } : {}) };
    });
    return { questions };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { error: error.message };
    }
    throw error;
  }
}

/** Appends one batch (plus the human's answers when any) to the operator review log (best-effort, newest last, capped). */
function recordBatch(workspace: ToolWorkspace, questions: AskedQuestion[], answers: AskUserReply | null): void {
  const view = asWorkspaceView(workspace);
  let stored: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(view.fs.readFile(ASK_USER_STORE_FILE));
    if (Array.isArray(parsed)) stored = parsed;
  } catch {
    // Missing or corrupt log starts fresh; the current questions still land below.
  }
  // No Clock port reaches tool handlers: order by append sequence instead of wall time.
  stored.push({ seq: stored.length, questions, answers: answers?.answered ? answers.answers : undefined });
  while (stored.length > MAX_STORED_RECORDS) stored.shift();
  view.fs.writeFile(ASK_USER_STORE_FILE, `${JSON.stringify(stored, null, 2)}\n`);
}

/** Renders the headless defer text (the no-human answer the model must proceed on). */
function deferText(questions: AskedQuestion[]): string {
  const lines = questions.map((item) => {
    const head = item.header !== "" ? `[${item.header}] ` : "";
    const opts = item.options.length > 0 ? ` (options: ${item.options.join(" / ")})` : "";
    return `- [${item.id}] ${head}${item.question}${opts}`;
  });
  return [
    "No human is available in this run (headless execution): the questions below were",
    `recorded to ${ASK_USER_STORE_FILE} for operator review. Proceed with the safest`,
    "assumption and continue working; do not stop or wait for an answer.",
    ...lines,
  ].join("\n");
}

async function executeAskUser(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  const parsed = parseAskedQuestions(args);
  if ("error" in parsed) {
    return { result: parsed.error, fileDiff: null, ok: false, code: "workspace_error" };
  }
  try {
    recordBatch(workspace, parsed.questions, null);
    return { result: boundText(workspace, "ask_user", deferText(parsed.questions)), fileDiff: null, ok: true };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
}

/** Builtin ask_user tool definition (headless: records and defers). */
export const askUserTool: ToolDefinition = {
  name: "ask_user",
  description:
    "Record blocking questions for later human review. The run is headless: nobody answers inline, so always proceed on the safest assumption after calling. Use only for genuine blockers, never for chatter. " +
    ASK_USER_FORMAT_EXAMPLE,
  jsonSchema: ASK_USER_JSON_SCHEMA,
  mutatesWorkspace: true,
  execute: executeAskUser,
};

/**
 * Interactive ask_user variant: hands the batch to the attached human and returns
 * the answers. When the human times out or skips, degrades to the same headless
 * defer text, so the model always gets a usable result and never blocks forever.
 *
 * @param respond Port to the attached human (UI round-trip; abort-aware).
 */
export function liveAskUserTool(respond: AskUserRespond): ToolDefinition {
  return {
    name: "ask_user",
    description:
      "Ask the attached human blocking questions and receive their answers inline. One call sends up to 5 questions; each may list candidate options. The human may skip, so after the call always verify assumptions before acting on them. Use only for genuine blockers, never for chatter. " +
      ASK_USER_FORMAT_EXAMPLE,
    jsonSchema: ASK_USER_JSON_SCHEMA,
    mutatesWorkspace: true,
    execute: async (workspace, args, signal) => {
      const parsed = parseAskedQuestions(args);
      if ("error" in parsed) {
        return { result: parsed.error, fileDiff: null, ok: false, code: "workspace_error" };
      }
      let reply: AskUserReply;
      try {
        reply = await respond(parsed.questions, signal);
      } catch (error) {
        if ((error as Error)?.name === "AbortError") throw error;
        return {
          result: `Error: ask_user channel failed: ${error instanceof Error ? error.message : String(error)}`,
          fileDiff: null,
          ok: false,
          code: "workspace_error",
        };
      }
      recordBatch(workspace, parsed.questions, reply);
      if (!reply.answered) {
        return { result: boundText(workspace, "ask_user", deferText(parsed.questions)), fileDiff: null, ok: true };
      }
      const byId = new Map(reply.answers.map((entry) => [entry.id, entry.answer]));
      const lines = parsed.questions.map((item) => {
        const answer = byId.get(item.id) ?? "";
        const suffix = answer.trim() === "" ? "(skipped: proceed on the safest assumption)" : answer;
        return `- [${item.id}] ${suffix}`;
      });
      return {
        result: boundText(workspace, "ask_user", `The human answered inline:\n${lines.join("\n")}`),
        fileDiff: null,
        ok: true,
      };
    },
  };
}
