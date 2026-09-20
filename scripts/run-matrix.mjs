/**
 * @file run-matrix
 * @description One-command comparison matrix against a running server.
 *
 * Responsibilities:
 * - Run scored template cells via POST /api/arena/matrix (SSE progress)
 * - Print the final markdown scoreboard (stdout plus optional file)
 *
 * Usage: `pnpm dev:server` in one shell, then
 * `node scripts/run-matrix.mjs [--base http://localhost:8281] [--out matrix.md]
 *   [--templates mcp_fs_probe,skill_commit_format] [--timeout-ms 600000]`
 * Without --templates, all scored ablation templates run. Each cell posts one
 * /api/arena/run SSE stream, extracts per-column answers with the same
 * last-thought/observation priority as the harness extractor, then judges.
 * Requires a configured provider (runs spend real model calls).
 */

const DEFAULT_BASE = process.env["ARENA_BASE"] ?? "http://localhost:8281";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1] ?? fallback;
}

/** Mirrors harness extractAnswerFromEvents (last thought wins, else last observation). */
function extractAnswer(events) {
  let lastThought = "";
  let streaming = "";
  let lastObs = "";
  for (const event of events) {
    if (event.type === "thought") {
      if (typeof event.content === "string" && event.content.startsWith("[")) continue;
      streaming = event.content ?? "";
      lastThought = streaming;
    } else if (event.type === "thought_delta") {
      const chunk = event.content ?? "";
      if (chunk === "") continue;
      streaming += chunk;
      lastThought = streaming;
    } else if (event.type === "thought_end") {
      lastThought = event.content ? event.content : streaming;
      streaming = "";
    } else if (event.type === "observation") {
      lastObs = event.result ?? "";
    }
  }
  return (lastThought || lastObs).slice(0, 2000).trim();
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function main() {
  const base = argValue("--base", DEFAULT_BASE);
  const out = argValue("--out", "");
  const timeoutMs = Number.parseInt(argValue("--timeout-ms", "1800000"), 10);
  const only = argValue("--templates", "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");

  const { templates } = await fetchJson(`${base}/api/arena/templates`);
  const cells = templates
    .filter((t) => t.category === "scored" && (only.length === 0 || only.includes(t.id)))
    .map((t) => ({ template_id: t.id }));
  if (cells.length === 0) throw new Error("no scored templates matched");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let report = null;
  try {
    const res = await fetch(`${base}/api/arena/matrix`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ cells }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`matrix failed: HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "" || payload === "[DONE]") continue;
          const item = JSON.parse(payload);
          if (item.type === "matrix_progress") {
            process.stdout.write(`[${item.status}] ${item.template_id} ${item.score}${item.error ? ` (${item.error})` : ""}\n`);
          } else if (item.type === "matrix_report") {
            report = item.report;
          } else if (item.type === "error") {
            throw new Error(item.message ?? "matrix stream error");
          }
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (report === null) throw new Error("matrix stream ended without a report");
  const lines = [
    "# Comparison matrix",
    "",
    `base: ${base}`,
    `cells: ${report.cells.length} (${Math.round((report.finishedAt - report.startedAt) / 1000)}s)`,
    "",
    "| template | dimension | selections | score | tokens | tools | columns |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const cell of report.cells) {
    const columns = Object.entries(cell.columns)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([label, passed]) => `${label}=${passed ? "pass" : "FAIL"}`)
      .join(", ");
    const metrics = cell.metrics ?? null;
    lines.push(`| ${cell.template_id} | ${cell.dimension} | ${cell.selections.join("+")} | ${cell.score.passed}/${cell.score.total} | ${metrics?.total_tokens ?? "-"} | ${metrics?.tool_calls ?? "-"} | ${columns || "-"} |`);
  }
  const text = lines.join("\n") + "\n";
  if (out !== "") {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(out, text, "utf-8");
  }
  process.stdout.write(text);
}

main().catch((error) => {
  console.error(`run-matrix failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
