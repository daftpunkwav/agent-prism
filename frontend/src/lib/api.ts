const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export type DimensionId =
  | "framework"
  | "prompt"
  | "reasoning"
  | "context"
  | "harness"
  | "temperature"
  | "model"
  | "thinking"
  | "max_steps"
  | "toolset";

export type ThinkingLevel = "off" | "low" | "medium" | "high";

export interface DimensionOption {
  field: string;
  value: string;
  label: string;
}

export interface DimensionMeta {
  id: DimensionId;
  label: string;
  subtitle: string;
  options: DimensionOption[];
  min_select: number;
  max_select: number;
}

export interface BaselineFieldOption {
  value: string;
  label: string;
}

export interface BaselineField {
  dimension: DimensionId | null;
  field: string;
  label: string;
  default: string;
  options: BaselineFieldOption[];
  /** pipeline | decode | access */
  group?: string;
}

export interface ArenaMeta {
  dimensions: DimensionMeta[];
  frameworks: Array<{ id: string; name: string; status: string }>;
  baseline_defaults?: Record<string, string>;
  baseline_fields?: BaselineField[];
  /** Settings 中是否已配置 ≥2 个真实模型，可供模型维对比 */
  model_compare_ready?: boolean;
}

/** 控制变量基线覆盖（不含当前对比维） */
export type BaselineOverrides = Partial<{
  framework: string;
  reasoning: string;
  context: string;
  harness: string;
  prompt_profile: string;
  temperature: string;
  endpoint_id: string;
  model_id: string;
  thinking_level: string;
  top_p: string;
  frequency_penalty: string;
  presence_penalty: string;
  max_output_tokens: string;
  max_steps: string;
  toolset: string;
}>;

export interface LlmEndpointPublic {
  id: string;
  label: string;
  provider_name: string;
  api_key_set: boolean;
  api_key_preview: string;
  base_url: string;
  use_full_url: boolean;
  api_format: string;
  auth_field: string;
  model: string;
  context_window: number;
  max_input_tokens: number;
  max_output_tokens?: number;
  website_url?: string;
  thinking_capable?: boolean;
  thinking_level?: ThinkingLevel | string;
}

export interface ProviderConfig {
  notes: string;
  website_url: string;
  endpoints?: LlmEndpointPublic[];
  default_endpoint_id?: string;
  temperature: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  max_output_tokens: number;
  /** 默认接入点镜像 */
  provider_name: string;
  api_key_set: boolean;
  api_key_preview: string;
  base_url: string;
  use_full_url: boolean;
  api_format: string;
  auth_field: string;
  model: string;
  /** 兼容旧字段 */
  models?: string[];
  context_window: number;
  max_input_tokens: number;
}

export interface TokenStats {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  context_window: number;
  max_input_tokens: number;
  max_output_tokens: number;
  context_usage_pct: number;
  input_usage_pct: number;
}

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * SSE 事件判别联合（discriminated union by `type`）。
 *
 * 每种事件类型只携带它真正用到的字段；新增字段时编译器会强制处理所有分支。
 * ``turn`` 为多轮对话轮次（1-based）；缺省/0 表示单轮。
 */
export type ArenaEvent =
  | { type: "thought"; pipeline: string; content?: string; step?: number; turn?: number }
  | { type: "thought_delta"; pipeline: string; content: string; step?: number; turn?: number }
  | { type: "thought_end"; pipeline: string; content?: string; step?: number; turn?: number }
  | {
      type: "action";
      pipeline: string;
      tool: string;
      args?: Record<string, unknown>;
      step?: number;
      turn?: number;
    }
  | { type: "observation"; pipeline: string; result: string; step?: number; turn?: number }
  | {
      type: "verify";
      pipeline: string;
      passed?: boolean;
      content?: string;
      reason?: string;
      step?: number;
      turn?: number;
    }
  | {
      type: "reflect";
      pipeline: string;
      content?: string;
      reason?: string;
      step?: number;
      turn?: number;
    }
  | {
      type: "harness_edit";
      pipeline: string;
      content?: string;
      reason?: string;
      step?: number;
      turn?: number;
    }
  | {
      type: "complete";
      pipeline: string;
      metrics?: PipelineMetrics;
      token_stats?: TokenStats;
      workspace?: string;
      turn?: number;
    }
  | { type: "error"; pipeline: string; message?: string; turn?: number }
  | {
      type: "token_update";
      pipeline: string;
      token_stats: TokenStats;
      workspace?: string;
      turn?: number;
    }
  | { type: "thinking"; pipeline: string; content?: string; step?: number; turn?: number };

export interface PipelineMetrics {
  success: boolean;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  tool_calls: number;
  steps: number;
  context_window: number;
  max_input_tokens: number;
  max_output_tokens: number;
  context_usage_pct: number;
  input_usage_pct: number;
}

export async function fetchArenaMeta(options?: { signal?: AbortSignal }): Promise<ArenaMeta> {
  const res = await fetch(`${API_BASE}/api/arena/meta`, {
    cache: "no-store",
    signal: options?.signal,
  });
  if (!res.ok) throw new Error("无法加载 Arena 元数据");
  return res.json();
}

export async function fetchProvider(options?: { signal?: AbortSignal }): Promise<ProviderConfig> {
  const res = await fetch(`${API_BASE}/api/settings/provider`, {
    cache: "no-store",
    signal: options?.signal,
  });
  if (!res.ok) throw new Error("无法加载 Provider 配置");
  return res.json();
}

/**
 * 保存 Provider 配置。
 *
 * 注意：``api_key`` 字段不应通过 body 发送 — 后端 ``api_key=""`` 的语义是
 * "保持已保存的 Key"，所以应当从 payload 中省略而不是传空串。
 * 其它所有字段均允许 PUT 更新。
 */
export async function saveProvider(body: Record<string, unknown>): Promise<ProviderConfig> {
  // 顶层空 api_key 省略；endpoints 内空 key 保留字段以便后端按 id 合并
  const payload = { ...body };
  const key = payload.api_key;
  if (typeof key !== "string" || !key.trim()) {
    delete payload.api_key;
  }
  if (Array.isArray(payload.endpoints)) {
    payload.endpoints = (payload.endpoints as Record<string, unknown>[]).map((ep) => {
      const next = { ...ep };
      if (typeof next.api_key !== "string" || !String(next.api_key).trim()) {
        next.api_key = "";
      }
      return next;
    });
  }
  const res = await fetch(`${API_BASE}/api/settings/provider`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = "保存失败";
    try {
      const err = await res.json();
      if (typeof err?.detail === "string") detail = err.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

export async function testProvider(body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/api/settings/provider/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** 判断是否为用户主动取消（fetch / ReadableStream abort）。 */
export function isAbortError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name: unknown }).name) : "";
  if (name === "AbortError") return true;
  // Chromium：BodyStreamBuffer was aborted
  const message = "message" in err ? String((err as { message: unknown }).message) : "";
  return /aborted|BodyStreamBuffer/i.test(message);
}

/**
 * 流式订阅 Arena 运行结果。
 *
 * SSE 解析要点：
 * - 支持命名事件 (``event: <name>\ndata: ...``) — 透传给 onEvent
 * - 识别 ``data: [DONE]`` sentinel — 静默结束
 * - JSON 解析错误累积到 ``onParseError``（不再静默吞）
 * - 整个 read 循环使用传入的 AbortSignal：组件卸载时立刻断开
 */
export async function streamArenaRun(
  question: string,
  dimension: DimensionId,
  onEvent: (event: ArenaEvent) => void,
  signal?: AbortSignal,
  selections?: string[],
  baseline?: BaselineOverrides,
  onParseError?: (raw: string, err: Error) => void,
  messages?: ChatMessage[],
): Promise<void> {
  let res: Response;
  try {
    const body: Record<string, unknown> = {
      question,
      dimension,
      selections: selections ?? [],
    };
    if (baseline && Object.keys(baseline).length > 0) {
      body.baseline = baseline;
    }
    if (messages && messages.length > 0) {
      body.messages = messages;
    }
    res = await fetch(`${API_BASE}/api/arena/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) return;
    throw err;
  }

  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(text || "Arena 运行失败");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // 当前事件块累积器：每个完整 SSE 块以空行结尾
  let eventName: string | null = null;
  let dataLines: string[] = [];

  const flush = () => {
    if (dataLines.length === 0) return;
    const json = dataLines.join("\n").trim();
    eventName = null;
    dataLines = [];
    if (!json) return;
    if (json === "[DONE]") return; // 静默结束
    try {
      onEvent(JSON.parse(json) as ArenaEvent);
    } catch (err) {
      if (onParseError) onParseError(json, err as Error);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // 按双换行拆 SSE 事件块
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const rawLine of part.split(/\r?\n/)) {
          if (!rawLine) continue;
          if (rawLine.startsWith(":")) continue; // 注释
          if (rawLine.startsWith("event:")) {
            eventName = rawLine.slice(6).trim();
          } else if (rawLine.startsWith("data:")) {
            dataLines.push(rawLine.slice(5).trimStart());
          }
          // 忽略 id:/retry: 行（暂未使用）
        }
        flush();
      }
    }
    if (buffer.trim()) {
      // 收尾：剩余 buffer 也要按行解析
      for (const rawLine of buffer.split(/\r?\n/)) {
        if (rawLine.startsWith("data:")) {
          dataLines.push(rawLine.slice(5).trimStart());
        }
      }
      flush();
    }
  } catch (err) {
    // 用户点「停止」会 abort BodyStream；属预期路径，静默结束
    if (isAbortError(err) || signal?.aborted) return;
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // reader 已被 signal 触发 abort — 忽略
    }
  }
}

// ===== 任务模板 API =====

export interface JudgeSpec {
  type: "keyword" | "json" | "code" | "numeric" | "exclude" | "regex" | "none";
  any_of?: string[];
  all_of?: string[];
  min_hits?: number;
  required_fields?: string[];
  must_contain?: string[];
  max_len?: number;
  operator?: "==" | ">=" | "<=" | ">" | "<";
  value?: number;
  tolerance?: number;
  patterns?: string[];
  pattern?: string;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  question: string;
  suggested_dimension: DimensionId;
  suggested_selections: string[];
  judge: JudgeSpec;
  category?: "scored" | "quick";
}

export interface JudgeResult {
  passed: boolean;
  reason: string;
  details: string[];
}

export async function fetchTemplates(options?: { signal?: AbortSignal }): Promise<TaskTemplate[]> {
  const res = await fetch(`${API_BASE}/api/arena/templates`, {
    cache: "no-store",
    signal: options?.signal,
  });
  if (!res.ok) throw new Error("加载任务模板失败");
  const data = await res.json();
  return data.templates || [];
}

export async function judgeAnswers(
  templateId: string,
  answers: Record<string, string>,
): Promise<Record<string, JudgeResult>> {
  const res = await fetch(`${API_BASE}/api/arena/judge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template_id: templateId, answers }),
  });
  if (!res.ok) throw new Error("判分失败");
  const data = await res.json();
  return data.results || {};
}

// ===== 项目管理 API =====

export interface PipelineRunResult {
  label: string;
  workspace: string;
  file_count: number;
  files: string[];
}

export interface Project {
  id: string;
  name: string;
  question: string;
  dimension: string;
  created_at: string;
  results: PipelineRunResult[];
  workspace_files: Record<string, Record<string, string>>;
  metrics_summary: Record<string, Record<string, number>>;
}

export interface ProjectCreate {
  name: string;
  question: string;
  dimension: string;
  pipeline_labels: string[];
  workspace_names: string[];
}

export async function listProjects(signal?: AbortSignal): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/api/arena/projects`, { cache: "no-store", signal });
  if (!res.ok) throw new Error("加载项目失败");
  const data = await res.json();
  return data.projects || [];
}

export async function createProject(body: ProjectCreate): Promise<{ project: Project }> {
  const res = await fetch(`${API_BASE}/api/arena/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("创建项目失败");
  return res.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/arena/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error("删除项目失败");
}

// ===== Workspace API =====

export interface WorkspaceFileEntry {
  path: string;
  size: number;
}

export async function listWorkspaceFiles(workspaceName: string, signal?: AbortSignal): Promise<WorkspaceFileEntry[]> {
  const res = await fetch(
    `${API_BASE}/api/arena/workspace/${encodeURIComponent(workspaceName)}/files`,
    { signal },
  );
  if (!res.ok) throw new Error("加载文件列表失败");
  const data = await res.json();
  return data.files || [];
}

export async function readWorkspaceFile(
  workspaceName: string,
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(
    `${API_BASE}/api/arena/workspace/${encodeURIComponent(workspaceName)}/file?path=${encodeURIComponent(path)}`,
    { signal },
  );
  if (!res.ok) throw new Error("读取文件失败");
  const data = await res.json();
  return data.content || "";
}

export async function saveWorkspaceFile(
  workspaceName: string,
  path: string,
  content: string,
  createOnly = false,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/arena/workspace/${encodeURIComponent(workspaceName)}/file`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content, create_only: createOnly }),
      signal,
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "保存失败" }));
    throw new Error(err.detail || "保存失败");
  }
}

export async function deleteWorkspaceFile(
  workspaceName: string,
  path: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/arena/workspace/${encodeURIComponent(workspaceName)}/file?path=${encodeURIComponent(path)}`,
    { method: "DELETE", signal },
  );
  if (!res.ok) throw new Error("删除文件失败");
}
