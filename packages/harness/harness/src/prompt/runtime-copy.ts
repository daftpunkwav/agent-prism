/**
 * @file prompt/runtime-copy
 * @description Single source for runtime model-facing copy injected outside the
 *              section assembly (tool results, guards, verification calls).
 *
 * Responsibilities:
 * - Own every string the harness sends to the model outside builtin-sections:
 *   task anchoring, guard rejections, repeat reminders, memory/roster/notices
 *   block templates, structured finalize, and verification judge/reflect/evolve
 *   instructions
 * - Export string constants and pure copy templates only: no business logic,
 *   no I/O — edit copy here, never in the consuming call sites
 *
 * Copy is byte-stable: tests lock several of these outputs, so wording changes
 * belong in a dedicated tuning pass with the harness tests updated alongside.
 */

// ===== Task anchoring (context/anchoring) =====

/** Appends the unique task to the first system message. */
export function systemTaskAnchor(question: string): string {
  return (
    `\n\n[Unique task] ${question.trim()}\n` +
    "Stop after completing this task. Do not start any new topic or new task."
  );
}

/** Appends the task anchor to tool-result text, avoiding an extra user turn. */
export function toolResultAnchor(result: string, question: string): string {
  const q = question.trim() || "(unknown)";
  return (
    `${result}\n\n` +
    `—\n[Task anchor] User's original question: ${q}\n` +
    "If you can answer sufficiently, give the final answer and stop; do not start a new task."
  );
}

// ===== Tool-guard rejections (control/tool-guard) =====

/** Drift rejection for a file-mutating call whose args do not match the question. */
export function fileDriftRejection(toolName: string, question: string): string {
  return `Guard rejected: args for tool ${toolName} are almost unrelated to the user question "${question}" (likely topic drift). Return to the original question; do not start a new task.`;
}

/** Drift rejection for a call that repeats prior work instead of answering. */
export function callDriftRejection(toolName: string, question: string): string {
  return `Guard rejected: calling ${toolName} after prior tool results drifts from the user question "${question}". If the original question can already be answered, give the final answer directly.`;
}

// ===== Repeat guard escalations (control/repeat-reminder) =====

/** First-threshold reminder: same call repeated N times. */
export function repeatGuardFirst(toolName: string, threshold: number, preview: string): string {
  return `[Repeat guard] \`${toolName}\` called ${threshold}x in a row with the same arguments (${preview}). If the result already answers the task, stop and report it; otherwise vary the arguments or try a different tool.`;
}

/** Escalated reminder: the repetition looks like a loop. */
export function repeatGuardLoop(toolName: string, threshold: number): string {
  return `[Repeat guard] \`${toolName}\` called ${threshold}x in a row unchanged — this looks like a loop. State what new information the next identical call could possibly yield; if none, stop calling it.`;
}

// ===== System-prompt block templates (prompt/assembly) =====

/** One episodic memory line ("- In a similar task ... the run ..."). */
export function episodicMemoryLine(task: string, outcome: string, via: string, lesson: string): string {
  return `- In a similar task "${task}" the run ${outcome}${via}${lesson}`.trim();
}

/** One semantic memory line ("- Project convention: ..."). */
export function semanticMemoryLine(subject: string, predicate: string, object: string): string {
  return `- Project convention: ${subject} ${predicate} ${object}.`.trim();
}

/** Memory block header prefixing the mounted memory lines. */
export const MEMORY_BLOCK_HEADER = "\n\n[Prior Experience & Relevant Memories]\n";

/** System-suffix line mounting the authoritative tool roster. */
export function toolRosterLine(names: readonly string[]): string {
  return `\n\nAvailable tools: ${names.join(", ")}.`;
}

/** System-suffix block mounting the previous verification reflection. */
export function reflectionBlock(feedback: string): string {
  return `\n\n[Previous reflection]\n${feedback}`;
}

/** One session notice line ("[Session update] ..."). */
export function sessionNoticeLine(notice: string): string {
  return `[Session update] ${notice}`;
}

// ===== Structured finalize (structured-finalize) =====

/** Finalize system instruction; field names mirror FINAL_ANSWER_RESPONSE_FORMAT. */
export const FINALIZE_SYSTEM =
  'You restate final answers as strict JSON. Reply with exactly one JSON object with keys ' +
  '"plan" (string), "files" (array of artifact path strings), "how_to_run" (string). ' +
  "No prose, no code fences.";

/** Finalize user instruction wrapping the raw answer. */
export function finalizeRestateRequest(rawAnswer: string): string {
  return (
    "Restate this final answer as the JSON object described in the system message.\n\n" +
    `Final answer:\n${rawAnswer}`
  );
}

// ===== Verification loop (verification/judge, reflect, evolve) =====

/** Judge instruction: verify accuracy/completeness, answer as strict JSON. */
export function judgeInstruction(question: string, answer: string, toolCalls: number): string {
  return (
    `Evaluate whether the answer is accurate and complete. Output JSON: {"passed": true/false, "reason": "..."}\n\n` +
    `Question: ${question}\n\nAnswer: ${answer.slice(0, 2000)}\n\nTool calls: ${toolCalls}`
  );
}

/** Reflect instruction: produce insight/strategy JSON for the retry. */
export function reflectInstruction(question: string, answer: string, verificationReason: string): string {
  return (
    `Output JSON: {"insight":"...","strategy":"..."}\n\n` +
    `Question: ${question}\n\nAnswer: ${answer.slice(0, 2000)}\n\nReason: ${verificationReason}`
  );
}

/** Evolve instruction: propose prompt additions as JSON. */
export function evolveInstruction(question: string, currentPrompt: string, reflection: string): string {
  return (
    `Output JSON: {"prompt_additions":["..."],"reasoning":"..."}\n\n` +
    `Question: ${question}\n\nprompt: ${currentPrompt.slice(0, 500)}\n\nReflection: ${reflection}`
  );
}
