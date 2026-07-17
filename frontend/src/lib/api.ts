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

/** Arena SSE 事件类型 */
export interface ArenaEvent {
  type: string;
  pipeline: string;
  /** 工作空间名称（complete/token_update 等携带，供 WorkspacePanel 定位） */
  workspace?: string;
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  step?: number;
  message?: string;
  metrics?: ArenaEventMetrics;
  token_stats?: TokenStats;
  passed?: boolean;
  reason?: string;
}

export interface ArenaEventMetrics {
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

export async function saveProvider(body: Record<string, unknown>): Promise<ProviderConfig> {
  // 仅当 api_key 为空时省略该字段，让后端保留已保存的 Key；非空则必须发送（BYOK）
  const payload = { ...body };
  const key = payload.api_key;
  if (typeof key !== "string" || !key.trim()) {
    delete payload.api_key;
  }
  const res = await fetch(`${API_BASE}/api/settings/provider`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

export async function streamArenaRun(
  question: string,
  dimension: DimensionId,
  onEvent: (event: ArenaEvent) => void,
  signal?: AbortSignal,
  selections?: string[],
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

  const flush = (rawEvent: string) => {
    const lines = rawEvent.split(/\r?\n/);
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) return;
    const json = dataLines.join("\n").trim();
    if (!json || json === "[DONE]") return;
    try {
      onEvent(JSON.parse(json) as ArenaEvent);
    } catch {
      // 忽略无法解析的分片
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (part.trim()) flush(part);
      }
    }
    if (buffer.trim()) flush(buffer);
  } finally {
    reader.releaseLock();
  }
}

// ===== 项目管理 API =====

export interface Project {
  id: string;
  name: string;
  question: string;
  dimension: string;
  created_at: string;
  results: Array<{ label: string; workspace: string; file_count: number; files: string[] }>;
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
