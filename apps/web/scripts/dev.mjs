/**
 * @file dev
 * @description Web dev-server launcher.
 *
 * Responsibilities:
 * - Start the local runtime and the Next.js dev server together
 */

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import net from "node:net";

const require = createRequire(import.meta.url);

const DEFAULT_PORT = 8280;

/** Parses -p / --port from command-line args; returns the default port when absent. */
function resolvePort(argv) {
  for (let i = 0; i < argv.length - 1; i += 1) {
    const flag = argv[i];
    if (flag === "-p" || flag === "--port") {
      const value = Number(argv[i + 1]);
      if (Number.isInteger(value) && value > 0 && value <= 65535) {
        return value;
      }
      console.error(`Invalid port value: ${argv[i + 1]}`);
      process.exit(1);
    }
  }
  return DEFAULT_PORT;
}

/** Checks port occupancy with a bind + connect double probe. */
function portInUse(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.listen({ host, port }, () => {
      // A successful bind only proves this process can bind; close our own listener first, then
      // connect-probe whether something is already listening (any address family) to avoid connecting to ourselves (false positive).
      server.close(() => {
        const client = net.connect({ host, port });
        client.once("connect", () => {
          client.destroy();
          resolve(true);
        });
        client.once("error", () => resolve(false));
      });
    });
  });
}

/** Port occupied: print a friendly message and exit non-zero. */
function diePortConflict(host, port) {
  console.error(
    `\n⚠️  Port ${host}:${port} is already in use; cannot start the frontend.\n` +
      `\n` +
      `    Find what is using it:\n` +
      `      Windows:     netstat -ano | findstr :${port}\n` +
      `      macOS/Linux: lsof -i :${port}\n` +
      `\n` +
      `    Then either:\n` +
      `      1) Stop the process holding the port and retry; or\n` +
      `      2) Start on another port: pnpm dev -- -p <new-port>\n` +
      `\n`,
  );
  process.exit(1);
}

const HOST = "127.0.0.1";
const port = resolvePort(process.argv.slice(2));

portInUse(HOST, port).then((inUse) => {
  if (inUse) {
    diePortConflict(HOST, port);
    return;
  }
  console.log(
    `Frontend port preflight OK: ${HOST}:${port} (proxy target from root .env BACKEND_PORT)`,
  );
  const nextBin = require.resolve("next/dist/bin/next");
  // Force development: with a shell-global NODE_ENV=production, Next dev would mistakenly apply the production CSP
  // (no unsafe-eval in script-src), breaking client hydration and leaving Arena and other pages stuck loading.
  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development" },
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
});
