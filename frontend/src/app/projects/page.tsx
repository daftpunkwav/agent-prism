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
    // 卸载/重渲染时取消未完成请求，避免 setState on unmounted
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
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <div className="h-5 w-5 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin mr-3" />
        加载项目…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow mb-2">WORKSPACE</p>
          <h1 className="text-2xl font-semibold">项目</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            从 Arena 运行中创建项目，保存 Agent 工作空间和对比结果
          </p>
        </div>
        <Link href="/arena" className="btn-primary">
          <Plus className="h-4 w-4" />
          新实验
        </Link>
      </div>

      {error && (
        <p className="text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded px-3 py-2">
          {error}
        </p>
      )}

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-sm text-muted-foreground mb-4">还没有项目</p>
          <p className="text-xs text-muted-foreground/70 mb-6 max-w-sm">
            进入 Arena 运行实验后，点击「创建项目」将 Agent 输出和工作空间保存为项目
          </p>
          <Link href="/arena" className="btn-primary">
            <Zap className="h-4 w-4" />
            开始实验
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="rounded-lg border border-border bg-card p-5 hover:border-foreground/20 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <FolderOpen className="h-4 w-4 text-blue-500 shrink-0" />
                    <h3 className="font-semibold text-sm truncate">{project.name}</h3>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {project.dimension}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                    {project.question}
                  </p>
                  <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
                    <span>{project.results.length} 个结果</span>
                    {project.results.map((r) => (
                      <span key={r.label} className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-foreground/30" />
                        {r.label} ({r.file_count} 文件)
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 mt-2">
                    {new Date(project.created_at).toLocaleString("zh-CN")}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    className="btn-ghost !h-8 !px-2 text-[10px]"
                    onClick={() => onDelete(project.id)}
                    disabled={deleting === project.id}
                    aria-label={`删除项目 ${project.name}`}
                  >
                    {deleting === project.id ? (
                      <div className="h-3 w-3 border border-foreground/30 border-t-foreground rounded-full animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
