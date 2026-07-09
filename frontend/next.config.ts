import type { NextConfig } from "next";

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
  // Next.js 16 dev 默认阻止跨主机访问 dev 资源，
  // 用户以 127.0.0.1/localhost 任意一种访问时需显式允许。
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
