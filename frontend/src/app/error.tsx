"use client";

/**
 * 路由级错误边界 — 捕获渲染错误并提供重试，避免整页白屏。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="error-boundary">
      <h1>出错了</h1>
      <p>页面渲染时发生错误。你可以重试，或返回首页。</p>
      {error.digest ? (
        <p className="error-boundary-digest">错误编号：{error.digest}</p>
      ) : null}
      <div className="error-boundary-actions">
        <button type="button" className="btn-primary" onClick={reset}>
          重试
        </button>
        <a href="/" className="btn-ghost">
          返回首页
        </a>
      </div>
    </main>
  );
}
