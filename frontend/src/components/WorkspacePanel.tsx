"use client";

import { useState, useEffect, useCallback } from "react";
import { File, FolderOpen, X, RefreshCw, ChevronRight, ChevronDown } from "lucide-react";

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

  const loadFiles = useCallback(async () => {
    if (!workspaceName) return;
    try {
      const res = await fetch(`/api/arena/workspace/${encodeURIComponent(workspaceName)}/files`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    } catch {
      // 静默处理
    }
  }, [workspaceName]);

  const loadFile = useCallback(async (path: string) => {
    if (!workspaceName) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/arena/workspace/${encodeURIComponent(workspaceName)}/file?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setContent(data.content || "");
      }
    } catch {
      setContent("加载失败");
    } finally {
      setLoading(false);
    }
  }, [workspaceName]);

  useEffect(() => {
    if (!workspaceName) {
      setFiles([]);
      setSelectedFile(null);
      setContent("");
      return;
    }
    loadFiles();
    const timer = setInterval(loadFiles, pollInterval);
    return () => clearInterval(timer);
  }, [workspaceName, pollInterval, loadFiles]);

  useEffect(() => {
    if (selectedFile) {
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

  // 构建树形结构
  const tree = buildTree(files);

  if (!workspaceName) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground p-4 text-center">
        运行 Arena 后，每个 Agent 的工作空间将在此显示
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* 文件树 */}
      <div className="w-48 border-r border-border overflow-y-auto flex-shrink-0">
        <div className="sticky top-0 bg-card border-b border-border px-2 py-1.5 flex items-center justify-between">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            文件
          </span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground p-0.5"
            onClick={loadFiles}
            title="刷新"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
        <div className="p-1">
          {tree.length === 0 && (
            <p className="text-[10px] text-muted-foreground px-2 py-3">空工作空间</p>
          )}
          {tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              expanded={expandedDirs.has(node.path)}
              onToggle={(path) => toggleDir(path)}
              onSelect={setSelectedFile}
              selectedPath={selectedFile}
            />
          ))}
        </div>
      </div>

      {/* 文件内容 */}
      <div className="flex-1 overflow-y-auto min-w-0">
        {selectedFile ? (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5 bg-muted/30">
              <span className="text-xs font-mono truncate">{selectedFile}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground p-0.5"
                onClick={() => setSelectedFile(null)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <pre className="flex-1 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap break-words">
              {loading ? "加载中…" : content || "(空文件)"}
            </pre>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            选择文件查看内容
          </div>
        )}
      </div>
    </div>
  );
}

// ===== 树形组件 =====

interface FileTreeNode {
  path: string;
  name: string;
  children: FileTreeNode[];
}

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

  // Ensure root node exists
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
