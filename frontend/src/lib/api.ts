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

export interface ArenaEvent {
  type: string;
  pipeline: string;
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  step?: number;
  message?: string;
  metrics?: {
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
  };
  token_stats?: TokenStats;
}

export async function fetchArenaMeta(): Promise<ArenaMeta> {
  const res = await fetch(`${API_BASE}/api/arena/meta`, { cache: "no-store" });
  if (!res.ok) throw new Error("无法加载 Arena 元数据");
  return res.json();
}

export async function fetchProvider(): Promise<ProviderConfig> {
  const res = await fetch(`${API_BASE}/api/settings/provider`, { cache: "no-store" });
  if (!res.ok) throw new Error("无法加载 Provider 配置");
  return res.json();
}

export async function saveProvider(body: Record<string, unknown>): Promise<ProviderConfig> {
  const res = await fetch(`${API_BASE}/api/settings/provider`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
    const dataLines = rawEvent
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart());
    if (dataLines.length === 0) return;
    const json = dataLines.join("\n").trim();
    if (!json) return;
    try {
      onEvent(JSON.parse(json));
    } catch {
      // 忽略无法解析的分片
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) flush(part);
  }

  if (buffer.trim()) flush(buffer);
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

export async function listProjects(): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/api/arena/projects`, { cache: "no-store" });
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
