#!/usr/bin/env node
// @ts-check

import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import process from "node:process";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { relative, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_FILE = "HANDOFF.md";
const SCHEMA_PATH = resolve(REPO_ROOT, "docs/agent-handoff.schema.json");
const HANDOFF_PATH = "HANDOFF.md";
const HANDOFF_BEGIN = "<!-- REVIEWREADY_HANDOFF_JSON_BEGIN -->";
const HANDOFF_END = "<!-- REVIEWREADY_HANDOFF_JSON_END -->";
const HANDOFF_FENCE = "```json";

/** @param {string} source @returns {unknown} */
function parseJson(source) {
  return /** @type {unknown} */ (JSON.parse(source));
}

const schema = /** @type {import("ajv").AnySchema} */ (
  parseJson(readFileSync(SCHEMA_PATH, "utf8"))
);
const schemaValidator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

/**
 * @typedef {{
 *   document_type: "REVIEWREADY_CANONICAL_AGENT_HANDOFF",
 *   schema_version: 1,
 *   project: "ReviewReady",
 *   updated_at: string,
 *   revision: string,
 *   branch: string,
 *   worktree_state: "clean" | "dirty",
 *   changed_paths: string[],
 *   change_digest: string,
 *   handoff_digest: string,
 *   route: "base" | "base+deep-research",
 *   phase: "research" | "repair" | "proof" | "handoff" | "defer-external",
 *   outcome: "promote" | "reopen" | "defer-external",
 *   active_slice: { id: string, objective: string, scope: string[], non_goals: string[], falsifier: string, exit_gate: string },
 *   next_action: { action: string, owner: string, gate: string },
 *   blockers: { id: string, class: "product" | "process" | "environment" | "evidence" | "external", status: "open" | "deferred" | "resolved", symptom: string, evidence: string, next_action: string }[],
 *   completed: { id: string, summary: string, evidence: string }[],
 *   validation: { command: string, status: "passed" | "failed" | "deferred", observed_at: string, revision: string, change_digest: string }[],
 *   external_writes: { pr: string, commit: string, push: string },
 *   read_order: string[]
 * }} Handoff

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {string | Buffer} value */
function sha256(value) {
  return "sha256:" + createHash("sha256").update(value).digest("hex");
}

/** @param {string} value */
function repoPath(value) {
  const relativePath = relative(REPO_ROOT, resolve(REPO_ROOT, value)).replaceAll("\\", "/");
  if (relativePath === ".." || relativePath.startsWith("../") || /^[A-Za-z]:/u.test(relativePath)) {
    throw new Error("handoff paths must stay within the repository");
  }
  return relativePath;
}

/** @param {string} value */
function parseStatus(value) {
  const parts = value.split("\0");
  /** @type {{ status: string, path: string }[]} */
  const entries = [];
  for (let index = 0; index < parts.length; index += 1) {
    const record = parts[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    let path = record.slice(3);
    if (status.includes("R") || status.includes("C")) {
      path = parts[index + 1] ?? path;
      index += 1;
    }
    entries.push({ status, path: repoPath(path) });
  }
  return entries;
}

/** @param {string[]} args */
function git(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

/** @param {string} [handoffPath] */
function collectWorktree(handoffPath = HANDOFF_PATH) {
  const raw = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const entries = parseStatus(raw);
  const worktreeEntries = entries.filter((entry) => entry.path !== handoffPath);
  return {
    branch: git(["branch", "--show-current"]),
    revision: git(["rev-parse", "HEAD"]),
    entries,
    changedPaths: [...new Set(worktreeEntries.map((entry) => entry.path))].sort(),
    worktreeState: worktreeEntries.length === 0 ? "clean" : "dirty"
  };
}

/** @param {string} handoffRevision @param {string} currentRevision @param {string} handoffPath */
function isSealedRevision(handoffRevision, currentRevision, handoffPath) {
  if (git(["merge-base", handoffRevision, currentRevision]) !== handoffRevision) {
    return false;
  }
  return (
    git([
      "diff",
      "--name-only",
      handoffRevision,
      currentRevision,
      "--",
      ".",
      `:(exclude)${handoffPath}`
    ]) === ""
  );
}

/** @param {{ status: string, path: string }[]} entries @param {string} handoffPath */
function worktreeDigest(entries, handoffPath) {
  const hash = createHash("sha256");
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    if (entry.path === handoffPath) continue;
    const absolutePath = resolve(REPO_ROOT, entry.path);
    const contents =
      existsSync(absolutePath) && statSync(absolutePath).isFile()
        ? readFileSync(absolutePath)
        : Buffer.from("<deleted>");
    // Git index state (`M ` versus ` M`) is not file-content evidence. A
    // validation record must survive staging the unchanged repair batch.
    hash.update(entry.path + "\0");
    hash.update(createHash("sha256").update(contents).digest("hex"));
    hash.update("\0");
  }
  return "sha256:" + hash.digest("hex");
}

/** @param {string} source */
export function parseHandoffDocument(source) {
  const pattern = new RegExp(
    "^" +
      HANDOFF_BEGIN.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") +
      "\\r?\\n" +
      "\\r?\\n?" +
      HANDOFF_FENCE +
      "\\r?\\n([\\s\\S]*?)\\r?\\n```\\r?\\n" +
      "\\r?\\n?" +
      HANDOFF_END.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") +
      "(?:\\r?\\n|$)"
  );
  const match = pattern.exec(source);
  if (!match) throw new Error("HANDOFF.md must begin with the canonical JSON payload");
  const jsonText = match[1];
  if (jsonText === undefined) throw new Error("HANDOFF.md JSON payload is missing");
  /** @type {unknown} */
  let value;
  try {
    value = parseJson(jsonText);
  } catch (error) {
    throw new Error(
      "invalid HANDOFF.md JSON: " + (error instanceof Error ? error.message : "unknown JSON error"),
      { cause: error }
    );
  }
  if (!isRecord(value)) {
    throw new Error("HANDOFF.md JSON payload must be an object");
  }
  return { value, body: source.slice(match[0].length) };
}

/** @param {Record<string, unknown>} value @param {string} body */
function digestHandoff(value, body) {
  return sha256(JSON.stringify({ ...value, handoff_digest: "" }) + "\n---BODY---\n" + body);
}

/** @param {Record<string, unknown>} value @param {string} body */
export function renderHandoffDocument(value, body) {
  return (
    HANDOFF_BEGIN +
    "\n\n" +
    HANDOFF_FENCE +
    "\n" +
    JSON.stringify(value, null, 2) +
    "\n```\n\n" +
    HANDOFF_END +
    "\n" +
    body
  );
}

export { worktreeDigest };

/** @param {string} message */
function fail(message) {
  throw new Error(message);
}

/** @param {string | Record<string, unknown>} source @param {{ workspace?: boolean, filePath?: string }} [options] */
export function validateHandoffDocument(source, options = {}) {
  const parsed =
    typeof source === "string" ? parseHandoffDocument(source) : { value: source, body: "" };
  const handoff = /** @type {Handoff} */ (parsed.value);
  if (!schemaValidator(handoff)) {
    const detail = (schemaValidator.errors ?? [])
      .map(
        (error) =>
          `${error.instancePath || "JSON payload"} ${error.message ?? "schema validation failed"}`
      )
      .join("; ");
    fail("HANDOFF.md JSON schema invalid: " + detail);
  }
  if (handoff.read_order[0] !== "AGENTS.md" || handoff.read_order[1] !== "HANDOFF.md") {
    fail("read_order must begin with AGENTS.md then HANDOFF.md");
  }
  if (handoff.outcome === "defer-external" && handoff.blockers.length === 0) {
    fail("defer-external handoff requires at least one blocker");
  }
  if (handoff.outcome === "promote" && handoff.blockers.length > 0) {
    fail("promote handoff cannot retain blockers");
  }
  if (handoff.phase === "defer-external" && handoff.outcome !== "defer-external") {
    fail("defer-external phase requires defer-external outcome");
  }
  for (const validation of handoff.validation) {
    if (
      validation.status === "passed" &&
      (validation.revision !== handoff.revision ||
        validation.change_digest !== handoff.change_digest)
    ) {
      fail(
        "HANDOFF.md contains passed validation evidence for an older worktree; rerun validation"
      );
    }
  }
  if (handoff.handoff_digest !== digestHandoff(handoff, parsed.body)) {
    fail("HANDOFF.md content changed without running handoff:refresh");
  }

  if (options.workspace !== false) {
    const handoffPath = repoPath(options.filePath ?? DEFAULT_FILE);
    const state = collectWorktree(handoffPath);
    const expectedPaths = [...handoff.changed_paths].sort();
    if (handoff.branch !== state.branch) fail("HANDOFF.md branch is stale");
    if (handoff.worktree_state !== state.worktreeState) fail("HANDOFF.md worktree_state is stale");
    if (handoff.worktree_state === "dirty") {
      if (handoff.revision !== state.revision) fail("HANDOFF.md revision is stale");
      if (JSON.stringify(expectedPaths) !== JSON.stringify(state.changedPaths)) {
        fail("HANDOFF.md changed_paths are stale; run handoff:refresh");
      }
      const expectedDigest = worktreeDigest(state.entries, handoffPath);
      if (handoff.change_digest !== expectedDigest) {
        fail("HANDOFF.md change_digest is stale; run handoff:refresh");
      }
    } else {
      if (!isSealedRevision(handoff.revision, state.revision, handoffPath)) {
        fail("clean HANDOFF.md must bind to the current revision or a handoff-only descendant");
      }
      if (handoff.change_digest !== worktreeDigest(state.entries, handoffPath)) {
        fail("sealed HANDOFF.md has a non-clean worktree digest");
      }
    }
  }
  return handoff;
}

/** @param {string[]} args */
function fileArgument(args) {
  if (args.length === 0) return DEFAULT_FILE;
  if (args.length === 2 && args[0] === "--file" && args[1] !== undefined) return args[1];
  throw new Error("usage: node scripts/agent-handoff.mjs <validate|refresh> [--file HANDOFF.md]");
}

/** @param {string} filePath */
function refresh(filePath) {
  const absolutePath = resolve(REPO_ROOT, filePath);
  if (!statSync(absolutePath).isFile()) fail("handoff path must be a regular file");
  const parsed = parseHandoffDocument(readFileSync(absolutePath, "utf8"));
  const handoffPath = repoPath(filePath);
  const state = collectWorktree(handoffPath);
  const handoff = /** @type {Record<string, unknown>} */ ({
    ...parsed.value,
    updated_at: new Date().toISOString(),
    revision: state.revision,
    branch: state.branch,
    worktree_state: state.worktreeState,
    changed_paths: state.changedPaths,
    change_digest: worktreeDigest(state.entries, handoffPath),
    handoff_digest: ""
  });
  const withoutDigest = renderHandoffDocument(handoff, parsed.body);
  const reparsed = parseHandoffDocument(withoutDigest);
  handoff.handoff_digest = digestHandoff(reparsed.value, reparsed.body);
  writeFileSync(absolutePath, renderHandoffDocument(handoff, parsed.body), "utf8");
  process.stdout.write(JSON.stringify({ refreshed: true, file: repoPath(filePath) }) + "\n");
}

export function main() {
  try {
    const [command, ...args] = process.argv.slice(2);
    const filePath = fileArgument(args);
    const absolutePath = resolve(REPO_ROOT, filePath);
    if (command === "validate") {
      if (!statSync(absolutePath).isFile()) fail("handoff path must be a regular file");
      const handoff = validateHandoffDocument(readFileSync(absolutePath, "utf8"), {
        workspace: true,
        filePath
      });
      process.stdout.write(
        JSON.stringify({ valid: true, file: repoPath(filePath), outcome: handoff.outcome }) + "\n"
      );
      return;
    }
    if (command === "refresh") {
      refresh(filePath);
      return;
    }
    throw new Error("command must be validate or refresh");
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : "handoff command failed") + "\n"
    );
    process.exitCode = 2;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
