const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export type DimensionId = "framework" | "prompt" | "reasoning" | "context" | "harness";

export interface ArenaMeta {
  dimensions: Array<{
    id: DimensionId;
    label: string;
    subtitle: string;
    columns: number;
    mvp: boolean;
  }>;
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
    total_tokens: number;
    tool_calls: number;
    steps: number;
  };
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
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/arena/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ question, dimension }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(text || "Arena 运行失败");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (json) onEvent(JSON.parse(json));
    }
  }
}
