const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export type DimensionId = "framework" | "prompt" | "reasoning" | "context" | "harness";

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

export interface ArenaMeta {
  dimensions: DimensionMeta[];
  frameworks: Array<{ id: string; name: string; status: string }>;
}

export interface ProviderConfig {
  provider_name: string;
  notes: string;
  website_url: string;
  api_key_set: boolean;
  api_key_preview: string;
  base_url: string;
  use_full_url: boolean;
  api_format: string;
  auth_field: string;
  model: string;
  temperature: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  context_window: number;
  max_input_tokens: number;
  max_output_tokens: number;
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

/**
 * SSE 事件判别联合（discriminated union by `type`）。
 *
 * 每种事件类型只携带它真正用到的字段；新增字段时编译器会强制处理所有分支。
 */
export type ArenaEvent =
  | { type: "thought"; pipeline: string; content?: string; step?: number }
  | { type: "thought_delta"; pipeline: string; content: string; step?: number }
  | { type: "thought_end"; pipeline: string; content?: string; step?: number }
  | { type: "action"; pipeline: string; tool: string; args?: Record<string, unknown>; step?: number }
  | { type: "observation"; pipeline: string; result: string; step?: number }
  | { type: "verify"; pipeline: string; passed?: boolean; content?: string; reason?: string; step?: number }
  | { type: "reflect"; pipeline: string; content?: string; reason?: string; step?: number }
  | { type: "harness_edit"; pipeline: string; content?: string; reason?: string; step?: number }
  | {
      type: "complete";
      pipeline: string;
      metrics?: PipelineMetrics;
      token_stats?: TokenStats;
      workspace?: string;
    }
  | { type: "error"; pipeline: string; message?: string }
  | { type: "token_update"; pipeline: string; token_stats: TokenStats; workspace?: string }
  | { type: "thinking"; pipeline: string; content?: string };

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
  // 防止意外覆盖 BYOK：如果调用方传了 api_key="" 或完全没设，剥掉该字段
  const { api_key: _omit, ...rest } = body as { api_key?: string };
  void _omit;
  const res = await fetch(`${API_BASE}/api/settings/provider`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rest),
  });
  if (!res.ok) throw new Error("保存失败");
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
  onParseError?: (raw: string, err: Error) => void,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/arena/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ question, dimension, selections: selections ?? [] }),
    signal,
  });

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
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // reader 已被 signal 触发 abort — 忽略
    }
  }
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
  const res = await fetch(`${API_BASE}/api/arena/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
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