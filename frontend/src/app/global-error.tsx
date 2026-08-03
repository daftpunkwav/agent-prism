"use client";

/**
 * 根布局错误边界 — 捕获 layout 级错误。
 * 必须自带 html/body，因为根 layout 可能已失败。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <main className="error-boundary">
          <h1>出错了</h1>
          <p>应用发生严重错误。请重试或刷新页面。</p>
          {error.digest ? (
            <p className="error-boundary-digest">错误编号：{error.digest}</p>
          ) : null}
          <div className="error-boundary-actions">
            <button type="button" onClick={reset}>
              重试
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
