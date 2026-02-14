#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { runNodeWatchedPaths } from "./run-node.mjs";

<<<<<<< HEAD
const WATCH_NODE_RUNNER = "scripts/run-node.mjs";
=======
const args = process.argv.slice(2);
const env = { ...process.env };
const cwd = process.cwd();
const compiler = "tsdown";
const watchSession = `${Date.now()}-${process.pid}`;
env.OPENCLAW_WATCH_MODE = "1";
env.OPENCLAW_WATCH_SESSION = watchSession;
if (args.length > 0) {
  env.OPENCLAW_WATCH_COMMAND = args.join(" ");
}
>>>>>>> 292150259 (fix: commit missing refreshConfigFromDisk type for CI build)

const buildWatchArgs = (args) => [
  ...runNodeWatchedPaths.flatMap((watchPath) => ["--watch-path", watchPath]),
  "--watch-preserve-output",
  WATCH_NODE_RUNNER,
  ...args,
];

export async function runWatchMain(params = {}) {
  const deps = {
    spawn: params.spawn ?? spawn,
    process: params.process ?? process,
    cwd: params.cwd ?? process.cwd(),
    args: params.args ?? process.argv.slice(2),
    env: params.env ? { ...params.env } : { ...process.env },
    now: params.now ?? Date.now,
  };

  const childEnv = { ...deps.env };
  const watchSession = `${deps.now()}-${deps.process.pid}`;
  childEnv.OPENCLAW_WATCH_MODE = "1";
  childEnv.OPENCLAW_WATCH_SESSION = watchSession;
  if (deps.args.length > 0) {
    childEnv.OPENCLAW_WATCH_COMMAND = deps.args.join(" ");
  }

  const watchProcess = deps.spawn(deps.process.execPath, buildWatchArgs(deps.args), {
    cwd: deps.cwd,
    env: childEnv,
    stdio: "inherit",
  });

  let settled = false;
  let onSigInt;
  let onSigTerm;

  const settle = (resolve, code) => {
    if (settled) {
      return;
    }
    settled = true;
    if (onSigInt) {
      deps.process.off("SIGINT", onSigInt);
    }
    if (onSigTerm) {
      deps.process.off("SIGTERM", onSigTerm);
    }
    resolve(code);
  };

  return await new Promise((resolve) => {
    onSigInt = () => {
      if (typeof watchProcess.kill === "function") {
        watchProcess.kill("SIGTERM");
      }
      settle(resolve, 130);
    };
    onSigTerm = () => {
      if (typeof watchProcess.kill === "function") {
        watchProcess.kill("SIGTERM");
      }
      settle(resolve, 143);
    };

    deps.process.on("SIGINT", onSigInt);
    deps.process.on("SIGTERM", onSigTerm);

    watchProcess.on("exit", (code, signal) => {
      if (signal) {
        settle(resolve, 1);
        return;
      }
      settle(resolve, code ?? 1);
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void runWatchMain()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
