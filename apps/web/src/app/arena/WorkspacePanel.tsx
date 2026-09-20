/**
 * @file WorkspacePanel
 * @description Run workspace file browser.
 *
 * Responsibilities:
 * - Poll the file listing and read files on demand
 * - Edit, save, create, and delete workspace files
 * - Refresh instantly on file_diff events
 */

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
} from "@agentprism/client";
import { useT } from "@/i18n/useT";

interface WorkspacePanelProps {
  /** Workspace name (unique identifier) */
  workspaceName: string | null;
  /** Poll interval in ms */
  pollInterval?: number;
  /** Instant refresh triggered by file_diff and similar events */
  refreshToken?: number;
  /** Tighter layout for embedding inside an Arena column. */
  compact?: boolean;
}

interface FileEntry {
  path: string;
  size: number;
}

/**
 * Run-workspace file browser with polling plus event-driven refresh.
 *
 * @param workspaceName Workspace segment, or null when nothing selected.
 * @param pollInterval File-list poll budget in ms.
 * @param refreshToken Bumped by file_diff events for instant refresh.
 * @param compact Tighter layout for embedding inside an Arena column.
 */
export function WorkspacePanel({ workspaceName, pollInterval = 2000, refreshToken = 0, compact = false }: WorkspacePanelProps) {
  const t = useT();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  /** Single-file read failure info; kept separate from content so an error message is never edited/saved over the remote file */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // File-list polling, single-file reads, and write operations (save/create/delete) each get
  // their own AbortController: writes are never mistakenly aborted by file switches or new reads,
  // preventing silent loss of edited content
  const listAbortRef = useRef<AbortController | null>(null);
  const readAbortRef = useRef<AbortController | null>(null);
  const writeAbortRef = useRef<AbortController | null>(null);
  // Toast timer — cleared on unmount to avoid setState on unmounted
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // On unmount, cancel all in-flight requests + the toast timer
  useEffect(() => {
    return () => {
      listAbortRef.current?.abort();
      readAbortRef.current?.abort();
      writeAbortRef.current?.abort();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // When switching workspaces, cancel the previous polling round and file read
  useEffect(() => {
    return () => {
      listAbortRef.current?.abort();
      listAbortRef.current = null;
      readAbortRef.current?.abort();
      readAbortRef.current = null;
      writeAbortRef.current?.abort();
      writeAbortRef.current = null;
    };
  }, [workspaceName]);

  const newListAbort = useCallback(() => {
    listAbortRef.current?.abort();
    const ac = new AbortController();
    listAbortRef.current = ac;
    return ac.signal;
  }, []);

  const newReadAbort = useCallback(() => {
    readAbortRef.current?.abort();
    const ac = new AbortController();
    readAbortRef.current = ac;
    return ac.signal;
  }, []);

  const newWriteAbort = useCallback(() => {
    writeAbortRef.current?.abort();
    const ac = new AbortController();
    writeAbortRef.current = ac;
    return ac.signal;
  }, []);

  const loadFiles = useCallback(async () => {
    if (!workspaceName) return;
    try {
      const files = await listWorkspaceFiles(workspaceName, newListAbort());
      setFiles(files);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        // Poll failures do not disturb the user, but leave a diagnostic trace
        console.warn(`[workspace] Failed to refresh file list: ${(err as Error).message}`);
      }
    }
  }, [workspaceName, newListAbort]);

  const loadFile = useCallback(
    async (path: string) => {
      if (!workspaceName) return;
      setLoading(true);
      setEditing(false);
      setLoadError(null);
      const signal = newReadAbort();
      try {
        const text = await readWorkspaceFile(workspaceName, path, signal);
        setContent(text);
        setEditContent(text);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          // Failure info lives separately, never in content: an error message edited/saved as file content would overwrite the remote file
          setContent("");
          setLoadError((err as Error).message);
        }
      } finally {
        // When superseded by a newer read's abort, do not settle loading; the latest read finalizes it
        if (!signal.aborted) setLoading(false);
      }
    },
    [workspaceName, newReadAbort],
  );

  const saveFile = useCallback(async () => {
    if (!workspaceName || !selectedFile) return;
    setSaving(true);
    try {
      await saveWorkspaceFile(workspaceName, selectedFile, editContent, false, newWriteAbort());
      setContent(editContent);
      setEditing(false);
      showToast(t("arena.ws.saved"));
      loadFiles();
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        showToast(t("arena.ws.saveFailed", { message: (err as Error).message }));
      }
    } finally {
      setSaving(false);
    }
  }, [workspaceName, selectedFile, editContent, loadFiles, newWriteAbort, showToast, t]);

  const createFile = useCallback(async () => {
    if (!workspaceName || !newFileName.trim()) return;
    const path = newFileName.trim();
    try {
      await saveWorkspaceFile(workspaceName, path, "", true, newWriteAbort());
      showToast(t("arena.ws.created", { path }));
      setNewFileName("");
      setShowNewFile(false);
      await loadFiles();
      setSelectedFile(path);
      loadFile(path);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        showToast(t("arena.ws.createFailed", { message: (err as Error).message }));
      }
    }
  }, [workspaceName, newFileName, loadFiles, loadFile, newWriteAbort, showToast, t]);

  const deleteFile = useCallback(
    async (path: string) => {
      if (!workspaceName) return;
      if (!confirm(t("arena.ws.confirmDelete", { path }))) return;
      try {
        await deleteWorkspaceFile(workspaceName, path, newWriteAbort());
        showToast(t("arena.ws.deleted"));
        if (selectedFile === path) {
          setSelectedFile(null);
          setContent("");
        }
        loadFiles();
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          showToast(t("arena.ws.deleteFailed", { message: (err as Error).message }));
        }
      }
    },
    [workspaceName, selectedFile, loadFiles, newWriteAbort, showToast, t],
  );

  useEffect(() => {
    setSelectedFile(null);
    setContent("");
    setEditing(false);
    setLoadError(null);
    if (!workspaceName) {
      setFiles([]);
      return;
    }
    loadFiles();
    // pollInterval <= 0: pause polling while the drawer is closed, avoiding background API hits
    if (pollInterval <= 0) return;
    const timer = setInterval(loadFiles, pollInterval);
    return () => clearInterval(timer);
  }, [workspaceName, pollInterval, loadFiles]);

  useEffect(() => {
    if (refreshToken > 0 && workspaceName) {
      loadFiles();
    }
  }, [refreshToken, workspaceName, loadFiles]);

  useEffect(() => {
    if (selectedFile) {
      // loadFile is a shared async loader; its synchronous setLoading trips a rule
      // false positive, since the real data updates all happen after an await.
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
      <div className={compact ? "px-3 py-4 text-[11px] text-muted-foreground" : "empty-state h-full !py-8 px-4"}>
        {!compact && (
          <div className="empty-state-icon">
            <FolderOpen className="h-5 w-5" />
          </div>
        )}
        <p className="text-xs leading-relaxed">{t("arena.ws.empty")}</p>
      </div>
    );
  }

  return (
    <div className={compact ? "relative flex flex-col h-[14rem]" : "relative flex flex-col h-full"}>
      {/* File tree */}
      <div className={"border-b border-border overflow-y-auto flex-shrink-0 " + (compact ? "max-h-28" : "max-h-40")}>
        <div className="sticky top-0 bg-[color-mix(in_srgb,var(--card)_92%,var(--muted))] border-b border-border px-2.5 py-2 flex items-center justify-between">
          <span className="eyebrow">{t("arena.label.workspace")}</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="btn-ghost !h-7 !w-7 !p-0"
              onClick={() => setShowNewFile(!showNewFile)}
              aria-label={t("arena.ws.newFile")}
              title={t("arena.ws.newFile")}
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="btn-ghost !h-7 !w-7 !p-0"
              onClick={loadFiles}
              aria-label={t("arena.ws.refreshAria")}
              title={t("arena.ws.refreshTitle")}
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div className="soft-collapse" data-open={showNewFile ? "true" : undefined}>
          <div className="soft-collapse-inner">
            <div className="px-2 py-1.5 border-b border-border flex items-center gap-1">
              <input
                autoFocus={showNewFile}
                className="flex-1 h-7 px-2 text-xs bg-input border border-border rounded-none font-mono"
                placeholder="main.py"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createFile();
                  if (e.key === "Escape") setShowNewFile(false);
                }}
                tabIndex={showNewFile ? 0 : -1}
              />
              <button
                type="button"
                className="btn-ghost !h-7 !px-2 text-[11px]"
                onClick={createFile}
                tabIndex={showNewFile ? 0 : -1}
              >
                {t("arena.ws.create")}
              </button>
            </div>
          </div>
        </div>

        <div className="p-1">
          {tree.length === 0 && (
            <p className="text-[11px] text-muted-foreground px-2 py-3">{t("arena.ws.emptyTree")}</p>
          )}
          {tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              expanded={expandedDirs.has(node.path)}
              expandedDirs={expandedDirs}
              onToggle={toggleDir}
              onSelect={setSelectedFile}
              selectedPath={selectedFile}
            />
          ))}
        </div>
      </div>

      {/* File contents */}
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
                      className="btn-ghost !h-7 !px-2 text-[11px]"
                      onClick={saveFile}
                      disabled={saving}
                    >
                      {saving ? (
                        <span className="h-3 w-3 border border-foreground/30 border-t-foreground rounded-full animate-spin" />
                      ) : (
                        <Save className="h-3 w-3" />
                      )}
                      {t("arena.ws.save")}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !h-7 !px-2 text-[11px]"
                      onClick={() => {
                        setEditContent(content);
                        setEditing(false);
                      }}
                    >
                      {t("arena.ws.cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-ghost !h-7 !px-2 text-[11px]"
                      disabled={!!loadError}
                      onClick={() => {
                        setEditContent(content);
                        setEditing(true);
                        // requestAnimationFrame — focus after the DOM updates
                        requestAnimationFrame(() => textareaRef.current?.focus());
                      }}
                      aria-label={t("arena.ws.editAria")}
                      title={t("arena.ws.editTitle")}
                    >
                      <Edit3 className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !h-7 !px-2 text-[11px]"
                      onClick={() => selectedFile && deleteFile(selectedFile)}
                      aria-label={t("arena.ws.deleteAria")}
                      title={t("arena.ws.deleteTitle")}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="btn-ghost !h-7 !px-2 text-[11px]"
                  onClick={() => setSelectedFile(null)}
                  aria-label={t("arena.ws.closeAria")}
                  title={t("arena.ws.closeTitle")}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>

            {editing ? (
              <textarea
                ref={textareaRef}
                className="flex-1 w-full p-3 text-xs font-mono bg-input resize-none border-0"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                spellCheck={false}
              />
            ) : (
                <pre className="flex-1 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap break-words">
                  {loading
                    ? t("arena.ws.loading")
                    : loadError
                      ? t("arena.ws.loadFailed", { message: loadError })
                      : content || t("arena.ws.emptyFile")}
                </pre>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground p-4 text-center">
            {t("arena.ws.selectFile")}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-3 right-3 left-3 bg-foreground text-background text-xs px-3 py-2 rounded-none shadow-lg animate-in fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

// ===== tree components =====

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  expanded: boolean;
  expandedDirs: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}

function TreeNode({ node, depth, expanded, expandedDirs, onToggle, onSelect, selectedPath }: TreeNodeProps) {
  const isDir = node.children.length > 0;
  const paddingLeft = depth * 12 + 6;

  if (isDir) {
    return (
      <div>
        <button
          type="button"
          className="w-full flex items-center gap-0.5 py-0.5 px-1 rounded-none text-left text-xs hover:bg-muted/50"
          style={{ paddingLeft }}
          onClick={() => onToggle(node.path)}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          )}
          <FolderOpen className="h-3 w-3 text-primary flex-shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expanded={expandedDirs.has(child.path)}
                expandedDirs={expandedDirs}
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
      className={`w-full flex items-center gap-0.5 py-0.5 px-1 rounded-none text-left text-xs hover:bg-muted/50 ${
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

    for (const part of parts) {
      // Skip empty segments (e.g. the leading empty segment when a path starts with "/")
      if (!part) continue;
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
