import { spawn, type ChildProcess } from "node:child_process";

/**
 * `npm run dev`: API server (auto-restarts on change) + Vite dev server with hot reload.
 * Vite proxies /api to the API server — open the URL Vite prints (http://localhost:5173).
 * `npm run demo` runs this same thing against a throwaway demo database.
 */
export function startDev(): void {
  const children: ChildProcess[] = [
    spawn("npx", ["tsx", "watch", "src/server/index.ts"], { stdio: "inherit", shell: true, env: process.env }),
    spawn("npx", ["vite"], { stdio: "inherit", shell: true, env: process.env }),
  ];
  const stop = () => {
    for (const child of children) child.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  for (const child of children) child.on("exit", (code) => code && stop());
}

if (process.argv[1]?.endsWith("dev.ts")) startDev();
