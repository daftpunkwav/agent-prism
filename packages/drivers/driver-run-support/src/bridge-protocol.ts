/**
 * @file bridge-protocol
 * @description NDJSON wire contract between a framework bootstrap process and
 *              the TypeScript bridge engine (shared by driver-autogen and
 *              driver-crewai).
 *
 * Responsibilities:
 * - Type every line crossing the child's stdin/stdout pipes
 * - Pin the request/response correlation and termination semantics
 *
 * Direction rules: the child writes `llm_request`, `tool_request`, `event`,
 * `final`, and `error`; the host writes `start`, `llm_response`, and
 * `tool_result`. `final` and `error` end the session; cancellation is a
 * host-side kill, so there is no graceful-stop line.
 */

/** Host -> child: the startup handshake (first line the host writes). */
export interface BridgeStart {
  type: "start";
  question: string;
  /** Tools the child may request, with the schema the framework advertises to its agents. */
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  /** Step budget. autogen maps it onto MaxMessageTermination; the crewai
      bootstrap is structurally bounded and the host enforces the budget on
      its llm_request handler instead. */
  maxSteps: number;
}

/** Child -> host: one framework LLM completion, round-tripped to the arena model. */
export interface BridgeLlmRequest {
  type: "llm_request";
  id: string;
  /** Neutral messages; tool payload rides as structured tool_calls when present. */
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
    toolCallId?: string;
    toolCalls?: Array<{ id: string; name: string; args: string }>;
  }>;
  /** Tool schemas the model may call in this completion. */
  tools?: Array<{ name: string; description: string }>;
}

/** Host -> child: completion result for the matching id. `content` carries the
 *  completion envelope the framework client parses — a JSON string of
 *  `{ content: string; toolCalls: Array<{ id; name; args }> }` — so the child
 *  pump can settle both llm and tool futures from one line shape. */
export interface BridgeLlmResponse {
  type: "llm_response";
  id: string;
  content: string;
}

/** Child -> host: the framework agent wants one arena tool executed. */
export interface BridgeToolRequest {
  type: "tool_request";
  id: string;
  name: string;
  args: string;
}

/** Host -> child: tool outcome for the matching id. */
export interface BridgeToolResult {
  type: "tool_result";
  id: string;
  ok: boolean;
  result: string;
}

/** Child -> host: a progress event the host translates into its event stream. */
export interface BridgeEvent {
  type: "event";
  kind: "assistant" | "thought" | "phase";
  speaker: string;
  content: string;
}

/** Child -> host: the run produced its final answer. */
export interface BridgeFinal {
  type: "final";
  answer: string;
}

/** Child -> host: the framework failed; ends the session with exit code 1. */
export interface BridgeError {
  type: "error";
  message: string;
}

export type ChildToHost = BridgeLlmRequest | BridgeToolRequest | BridgeEvent | BridgeFinal | BridgeError;
export type HostToChild = BridgeStart | BridgeLlmResponse | BridgeToolResult;
