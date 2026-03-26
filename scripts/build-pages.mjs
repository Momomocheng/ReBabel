import { spawnSync } from "node:child_process";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/ReBabel";
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(command, ["build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    GITHUB_PAGES: "true",
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
