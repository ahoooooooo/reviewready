#!/usr/bin/env node
// @ts-check

import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { resolve } from "node:path";
import { clearTimeout, setTimeout as setTimer } from "node:timers";
import { pathToFileURL } from "node:url";

export const CHILD_CANARY_SENTINEL = "codex-spawn-ok";
const STREAM_CANARY_SIZE = 128 * 1024;

/** @param {unknown} error @returns {string} */
function errorCode(error) {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string") return code;
  }
  return "spawn-error";
}

/**
 * Run one bounded, read-only child-process check without shell quoting.
 *
 * @param {string} [executable]
 * @returns {{ status: "passed", stdout: string, exitCode: number } | { status: "failed", code: string, message: string }}
 */
export function runChildCanary(executable = process.execPath) {
  const childExpression = "process.stdout.write(" + JSON.stringify(CHILD_CANARY_SENTINEL) + ")";
  const result = spawnSync(executable, ["-e", childExpression], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000
  });
  if (result.error) {
    return {
      status: "failed",
      code: errorCode(result.error),
      message: result.error.message
    };
  }
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  if (result.status !== 0 || stdout !== CHILD_CANARY_SENTINEL) {
    return {
      status: "failed",
      code: "unexpected-child-result",
      message: "exit=" + String(result.status) + " stdout=" + JSON.stringify(stdout)
    };
  }
  return { status: "passed", stdout, exitCode: result.status };
}

/**
 * Prove that a parent drains stdout and stderr before waiting for a child to
 * close. A large JSON-producing child can otherwise fill a Windows pipe and
 * look like a process timeout even when the child is healthy.
 *
 * @param {string} [executable]
 * @returns {Promise<
 *   { status: "passed", stdoutBytes: number } |
 *   { status: "failed", code: string, message: string, closeConfirmed?: boolean }
 * >}
 */
export function runStreamingChildCanary(executable = process.execPath, timeoutMs = 10_000) {
  const childExpression =
    "process.stdout.write('x'.repeat(" +
    String(STREAM_CANARY_SIZE) +
    ")); process.stderr.write('y'.repeat(" +
    String(STREAM_CANARY_SIZE) +
    "))";
  return new Promise((resolvePromise) => {
    const child = spawn(executable, ["-e", childExpression], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timer = setTimer(() => {
      if (settled) return;
      timedOut = true;
      try {
        child.kill();
      } catch {
        // The child may have exited between the timeout and kill.
      }
    }, timeoutMs);
    /** @param {{ status: "passed", stdoutBytes: number } | { status: "failed", code: string, message: string, closeConfirmed?: boolean }} result */
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => {
      if (timedOut) return;
      finish({
        status: "failed",
        code: errorCode(error),
        message: error.message
      });
    });
    child.once("close", (code) => {
      if (timedOut) {
        finish({
          status: "failed",
          code: "child-timeout",
          message: "streaming child timed out; close was confirmed",
          closeConfirmed: true
        });
        return;
      }
      if (
        code !== 0 ||
        stdout.length !== STREAM_CANARY_SIZE ||
        stderr.length !== STREAM_CANARY_SIZE
      ) {
        finish({
          status: "failed",
          code: "unexpected-stream-result",
          message:
            "exit=" +
            String(code) +
            " stdoutBytes=" +
            String(stdout.length) +
            " stderrBytes=" +
            String(stderr.length) +
            " expectedBytes=" +
            String(STREAM_CANARY_SIZE)
        });
        return;
      }
      finish({ status: "passed", stdoutBytes: stdout.length });
    });
    child.stdin.end();
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const basic = runChildCanary();
  const streaming = await runStreamingChildCanary();
  const result = {
    status: basic.status === "passed" && streaming.status === "passed" ? "passed" : "failed",
    basic,
    streaming
  };
  process.stdout.write(JSON.stringify(result) + "\n");
  if (result.status !== "passed") process.exitCode = 1;
}
