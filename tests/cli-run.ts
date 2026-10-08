import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli/main.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli/main.ts", import.meta.url));

// One CLI request answered in process, shaped like a spawned run's result: the same `runCli` the
// process entry calls, without a Node process per request. `stderr` is always empty, since the CLI
// writes nothing there.
export function cli(input?: string, args: string[] = []): { stdout: string; stderr: string; status: number } {
  return { ...runCli(args, input ?? ""), stderr: "" };
}

// The same request through a real process, for the tests that hold the process entry itself.
export function cliProcess(input?: string, args: string[] = []): { stdout: string; stderr: string; status: number | null } {
  return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    ...(input !== undefined && { input }),
  });
}
