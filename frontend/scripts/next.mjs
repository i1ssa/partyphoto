import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import nextEnv from "@next/env";

const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const frontendRoot = fileURLToPath(new URL("../", import.meta.url));
const [command, ...args] = process.argv.slice(2);

// Keep the existing root .env* files and Next.js precedence after moving the app.
process.env.NODE_ENV ??= command === "dev" ? "development" : "production";
nextEnv.loadEnvConfig(repositoryRoot, command === "dev");

// A fresh process preserves the loaded values without sharing Next's env-file cache.
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), command, frontendRoot, ...args], {
  env: process.env,
  stdio: "inherit",
});
const forwardInterrupt = () => child.kill("SIGINT");
const forwardTerminate = () => child.kill("SIGTERM");
process.on("SIGINT", forwardInterrupt);
process.on("SIGTERM", forwardTerminate);

function removeSignalHandlers() {
  process.removeListener("SIGINT", forwardInterrupt);
  process.removeListener("SIGTERM", forwardTerminate);
}

child.once("error", error => {
  removeSignalHandlers();
  console.error(`Could not start Next.js: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  removeSignalHandlers();
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
