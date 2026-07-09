"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  File,
  FolderOpen,
  X,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Edit3,
  Save,
  Plus,
  Trash2,
} from "lucide-react";
import {
  deleteWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  saveWorkspaceFile,
} from "@/lib/api";

interface WorkspacePanelProps {
  /** 工作空间名称（唯一标识） */
  workspaceName: string | null;
  /** 刷新频率 ms */
  pollInterval?: number;
}

interface FileEntry {
  path: string;
  size: number;
}

export function WorkspacePanel({ workspaceName, pollInterval = 2000 }: WorkspacePanelProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 当前 workspace 的 fetch 控制器，切换 workspace 时取消上一轮未完成的请求
  const fetchAbortRef = useRef<AbortController | null>(null);

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // 切换 workspace 时取消上一轮 polling
  useEffect(() => {
    return () => {
      fetchAbortRef.current?.abort();
      fetchAbortRef.current = null;
    };
  }, [workspaceName]);

  const newAbort = useCallback(() => {
    fetchAbortRef.current?.abort();
    const ac = new AbortController();
    fetchAbortRef.current = ac;
    return ac.signal;
  }, []);

  const loadFiles = useCallback(async () => {
    if (!workspaceName) return;
    try {
      const files = await listWorkspaceFiles(workspaceName, newAbort());
      setFiles(files);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        // 静默：轮询失败不打扰用户
      }
    }
  }, [workspaceName, newAbort]);

  const loadFile = useCallback(
    async (path: string) => {
      if (!workspaceName) return;
      setLoading(true);
      try {
        const text = await readWorkspaceFile(workspaceName, path, newAbort());
        setContent(text);
        setEditContent(text);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setContent(`加载失败: ${(err as Error).message}`);
        }
      } finally {
        setLoading(false);
      }
    },
    [workspaceName, newAbort],
  );

  const saveFile = useCallback(async () => {
    if (!workspaceName || !selectedFile) return;
    setSaving(true);
    try {
      await saveWorkspaceFile(workspaceName, selectedFile, editContent, false, newAbort());
      setContent(editContent);
      setEditing(false);
      flashToast("已保存");
      loadFiles();
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        flashToast(`保存失败: ${(err as Error).message}`);
      }
    } finally {
      setSaving(false);
    }
  }, [workspaceName, selectedFile, editContent, loadFiles, newAbort]);

  const createFile = useCallback(async () => {
    if (!workspaceName || !newFileName.trim()) return;
    const path = newFileName.trim();
    try {
      await saveWorkspaceFile(workspaceName, path, "", true, newAbort());
      flashToast(`已创建: ${path}`);
      setNewFileName("");
      setShowNewFile(false);
      await loadFiles();
      setSelectedFile(path);
      loadFile(path);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        flashToast(`创建失败: ${(err as Error).message}`);
      }
    }
  }, [workspaceName, newFileName, loadFiles, loadFile, newAbort]);

  const deleteFile = useCallback(
    async (path: string) => {
      if (!workspaceName) return;
      if (!confirm(`删除文件 ${path}？`)) return;
      try {
        await deleteWorkspaceFile(workspaceName, path, newAbort());
        flashToast("已删除");
        if (selectedFile === path) {
          setSelectedFile(null);
          setContent("");
        }
        loadFiles();
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          flashToast(`删除失败: ${(err as Error).message}`);
        }
      }
    },
    [workspaceName, selectedFile, loadFiles, newAbort],
  );

  useEffect(() => {
    if (!workspaceName) {
      setFiles([]);
      setSelectedFile(null);
      setContent("");
      setEditing(false);
      return;
    }
    loadFiles();
    const timer = setInterval(loadFiles, pollInterval);
    return () => clearInterval(timer);
  }, [workspaceName, pollInterval, loadFiles]);

  useEffect(() => {
    if (selectedFile) {
      setEditing(false);
      loadFile(selectedFile);
    }
  }, [selectedFile, loadFile]);

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const tree = buildTree(files);

  if (!workspaceName) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground p-4 text-center">
        运行 Arena 后，每个 Agent 的工作空间将在此显示
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 文件树 */}
      <div className="border-b border-border overflow-y-auto max-h-40 flex-shrink-0">
        <div className="sticky top-0 bg-card border-b border-border px-2 py-1.5 flex items-center justify-between">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            文件
          </span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground p-0.5"
              onClick={() => setShowNewFile(!showNewFile)}
              title="新建文件"
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground p-0.5"
              onClick={loadFiles}
              title="刷新"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        </div>

        {showNewFile && (
          <div className="px-2 py-1.5 border-b border-border flex items-center gap-1">
            <input
              autoFocus
              className="flex-1 h-7 px-2 text-xs bg-muted/30 border border-border rounded font-mono"
              placeholder="main.py"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createFile();
                if (e.key === "Escape") setShowNewFile(false);
              }}
            />
            <button
              type="button"
              className="btn-ghost !h-7 !px-2 text-[10px]"
              onClick={createFile}
            >
              创建
            </button>
          </div>
        )}

        <div className="p-1">
          {tree.length === 0 && (
            <p className="text-[10px] text-muted-foreground px-2 py-3">空工作空间 · 点击 + 新建</p>
          )}
          {tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              expanded={expandedDirs.has(node.path)}
              onToggle={toggleDir}
              onSelect={setSelectedFile}
              selectedPath={selectedFile}
            />
          ))}
        </div>
      </div>

      {/* 文件内容 */}
      <div className="flex-1 overflow-y-auto min-w-0 flex flex-col">
        {selectedFile ? (
          <>
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5 bg-muted/30 sticky top-0">
              <span className="text-xs font-mono truncate flex-1">{selectedFile}</span>
              <div className="flex items-center gap-0.5 shrink-0">
                {editing ? (
                  <>
                    <button
                      type="button"
                      className="btn-ghost !h-7 !px-2 text-[10px]"
                      onClick={saveFile}
                      disabled={saving}
                    >
                      {saving ? (
                        <span className="h-3 w-3 border border-foreground/30 border-t-foreground rounded-full animate-spin" />
                      ) : (
                        <Save className="h-3 w-3" />
                      )}
                      保存
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !h-7 !px-2 text-[10px]"
                      onClick={() => {
                        setEditContent(content);
                        setEditing(false);
                      }}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-ghost !h-7 !px-2 text-[10px]"
                      onClick={() => {
                        setEditContent(content);
                        setEditing(true);
                        setTimeout(() => textareaRef.current?.focus(), 50);
                      }}
                      title="编辑"
                    >
                      <Edit3 className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !h-7 !px-2 text-[10px]"
                      onClick={() => selectedFile && deleteFile(selectedFile)}
                      title="删除"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="btn-ghost !h-7 !px-2 text-[10px]"
                  onClick={() => setSelectedFile(null)}
                  title="关闭"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>

            {editing ? (
              <textarea
                ref={textareaRef}
                className="flex-1 w-full p-3 text-xs font-mono bg-card resize-none border-0 outline-none focus:ring-1 focus:ring-foreground/30"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                spellCheck={false}
              />
            ) : (
              <pre className="flex-1 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap break-words">
                {loading ? "加载中…" : content || "(空文件)"}
              </pre>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground p-4 text-center">
            选择文件查看或编辑
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-3 right-3 left-3 bg-foreground text-background text-xs px-3 py-2 rounded shadow-lg animate-in fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

// ===== 树形组件 =====

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  expanded: boolean;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}

function TreeNode({ node, depth, expanded, onToggle, onSelect, selectedPath }: TreeNodeProps) {
  const isDir = node.children.length > 0;
  const paddingLeft = depth * 12 + 6;

  if (isDir) {
    return (
      <div>
        <button
          type="button"
          className="w-full flex items-center gap-0.5 py-0.5 px-1 rounded text-left text-xs hover:bg-muted/50"
          style={{ paddingLeft }}
          onClick={() => onToggle(node.path)}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          )}
          <FolderOpen className="h-3 w-3 text-blue-500 flex-shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expanded={false}
                onToggle={onToggle}
                onSelect={onSelect}
                selectedPath={selectedPath}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`w-full flex items-center gap-0.5 py-0.5 px-1 rounded text-left text-xs hover:bg-muted/50 ${
        selectedPath === node.path ? "bg-muted text-foreground" : "text-muted-foreground"
      }`}
      style={{ paddingLeft: paddingLeft + 12 }}
      onClick={() => onSelect(node.path)}
    >
      <File className="h-3 w-3 flex-shrink-0" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

interface FileTreeNode {
  path: string;
  name: string;
  children: FileTreeNode[];
}

function buildTree(files: FileEntry[]): FileTreeNode[] {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const nodeMap = new Map<string, FileTreeNode>();

  const rootNode: FileTreeNode = { path: "", name: "workspace", children: [] };
  nodeMap.set("", rootNode);

  for (const file of sorted) {
    const parts = file.path.split("/");
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!nodeMap.has(currentPath)) {
        const node: FileTreeNode = {
          path: currentPath,
          name: part,
          children: [],
        };
        nodeMap.set(currentPath, node);
        const parent = nodeMap.get(parentPath)!;
        parent.children.push(node);
      }
    }
  }

  return rootNode.children;
}