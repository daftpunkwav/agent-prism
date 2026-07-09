import type { NextConfig } from "next";

/**
 * 安全响应头 — 全站应用。
 *
 * CSP 故意保持宽松（script-src 'self' 'unsafe-inline' 'unsafe-eval'）以兼容
 * Next.js dev 模式的热更新脚本；生产构建前应收紧。
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js dev 需 'unsafe-eval' / 'unsafe-inline' 用于 HMR；prod 应收紧
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        // 同源代理：浏览器请求 /api/* 由 Next.js 转发到后端，避免 CORS。
        // 后端默认 8000，如被占用可通过环境变量 BACKEND_PORT 覆盖。
        destination: `http://127.0.0.1:${process.env.BACKEND_PORT || 8000}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  // Next.js 16 dev 默认阻止跨主机访问 dev 资源，
  // 用户以 127.0.0.1/localhost 任意一种访问时需显式允许。
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
