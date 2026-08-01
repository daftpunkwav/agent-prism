"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FolderOpen, Plus, Trash2, Zap } from "lucide-react";
import { listProjects, deleteProject, type Project } from "@/lib/api";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    (async () => {
      try {
        const data = await listProjects(ac.signal);
        setProjects(data);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, []);

  const onDelete = async (id: string) => {
    if (!confirm("确定删除此项目？")) return;
    setDeleting(id);
    setError(null);
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
        <div className="loading-prism" aria-hidden />
        <p className="text-sm">加载项目…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 fade-in">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow mb-2">Workspace</p>
          <h1 className="page-title text-3xl">项目</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-lg leading-relaxed">
            从 Arena 运行中创建项目，保存 Agent 工作空间和对比结果
          </p>
        </div>
        <Link href="/arena" className="btn-primary">
          <Plus className="h-4 w-4" />
          新实验
        </Link>
      </div>

      <div className="spectrum-line-soft" aria-hidden />

      {error && (
        <p className="text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded-[var(--radius-sm)] px-3 py-2">
          {error}
        </p>
      )}

      {projects.length === 0 ? (
        <div className="panel-surface empty-state py-20">
          <div className="empty-state-icon !w-14 !h-14">
            <FolderOpen className="h-6 w-6" />
          </div>
          <p className="text-sm text-foreground font-medium">还没有项目</p>
          <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
            进入 Arena 运行实验后，在对比报告里创建项目，即可在此归档结果与工作空间
          </p>
          <Link href="/arena" className="btn-primary mt-2">
            <Zap className="h-4 w-4" />
            开始实验
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {projects.map((project, idx) => (
            <article
              key={project.id}
              className="panel-surface p-5 relative overflow-hidden group"
              style={{
                ["--lane" as string]: `var(--spectrum-${(idx % 4) + 1})`,
              }}
            >
              <span
                className="absolute inset-x-0 top-0 h-0.5 opacity-80"
                style={{ background: "var(--lane)" }}
                aria-hidden
              />
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <FolderOpen className="h-4 w-4 text-primary shrink-0" />
                    <h3 className="font-semibold text-sm truncate">{project.name}</h3>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0 rounded px-1.5 py-0.5 bg-muted border border-border">
                      {project.dimension}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3 line-clamp-2 leading-relaxed">
                    {project.question}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-muted-foreground">
                    <span>{project.results.length} 个结果</span>
                    {project.results.map((r, rIdx) => (
                      <span key={r.label} className="inline-flex items-center gap-1.5">
                        <span
                          className="w-1.5 h-1.5 rounded-sm"
                          style={{
                            background: `var(--spectrum-${(rIdx % 4) + 1})`,
                          }}
                        />
                        {r.label}
                        <span className="opacity-60">({r.file_count})</span>
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 mt-2.5 font-mono">
                    {new Date(project.created_at).toLocaleString("zh-CN")}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost !h-8 !w-8 !p-0 shrink-0 opacity-60 group-hover:opacity-100"
                  onClick={() => onDelete(project.id)}
                  disabled={deleting === project.id}
                  aria-label={`删除项目 ${project.name}`}
                >
                  {deleting === project.id ? (
                    <div className="h-3 w-3 border border-foreground/30 border-t-foreground rounded-full animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
