import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const DEFAULT_LOG_NAME = ".reviewready-agent-failures.ndjson";
const MAX_TEXT_LENGTH = 2_000;
const MAX_COMMAND_LENGTH = 1_000;
const FAILURE_CLASSES = new Set([
  "product",
  "process",
  "environment",
  "evidence",
  "external",
  "unclassified"
]);
const IMPACTS = new Set(["P0", "P1", "P2"]);
const STAGES = new Set(["baseline", "frame", "attack", "proof", "handoff"]);
const NEXT_ACTIONS = new Set(["repair-batch", "defer-external", "continue", "stop"]);
const IMPACT_ORDER = new Map([
  ["P0", 3],
  ["P1", 2],
  ["P2", 1]
]);

/**
 * @typedef {{
 *   schemaVersion: number,
 *   event: "failure",
 *   id: string,
 *   createdAt: string,
 *   failureClass: string,
 *   impact: string,
 *   stage: string,
 *   next: string,
 *   command: string,
 *   symptom: string,
 *   evidence: string,
 *   fingerprint: string,
 *   status: "open",
 *   retryAllowed: false
 * } | {
 *   schemaVersion: number,
 *   event: "resolution",
 *   id: string,
 *   createdAt: string,
 *   fingerprint: string,
 *   resolution: string,
 *   status: "resolved"
 * }} FailureEvent
 * @typedef {{
 *   count: number,
 *   failureClass: string,
 *   fingerprint: string,
 *   firstSeen: string,
 *   impact: string,
 *   nextActions: Set<string>,
 *   status: "open" | "resolved",
 *   symptoms: Set<string>,
 *   lastSeen: string,
 *   resolution?: string,
 *   resolvedAt?: string
 * }} FailureGroup
 * @typedef {{
 *   command: string,
 *   evidence: string,
 *   failureClass: string,
 *   impact: string,
 *   logPath?: string,
 *   next: string,
 *   stage: string,
 *   symptom: string
 * }} RecordFailureInput
 */

/** @param {string} value */
function redact(value) {
  return value
    .replace(
      /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9_-]{20,})\b/giu,
      "[REDACTED_TOKEN]"
    )
    .replace(/\bAKIA[0-9A-Z]{16}\b/gu, "[REDACTED_AWS_KEY]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/giu, "$1[REDACTED_URL_CREDENTIAL]@")
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(
      /-----BEGIN[\s\S]*?PRIVATE KEY-----[\s\S]*?-----END[\s\S]*?PRIVATE KEY-----/gu,
      "[REDACTED_PRIVATE_KEY]"
    )
    .replace(
      /\b(?:token|password|secret|private[_ -]?key|api[_ -]?key|access[_ -]?token|client[_ -]?secret|authorization|aws[_ -]?secret[_ -]?access[_ -]?key)\b\s*[:=]\s*[^\s,;]+/giu,
      "$1=[REDACTED]"
    );
}

/** @param {string} value @param {number} limit */
function bounded(value, limit) {
  const clean = redact(value);
  return clean.length <= limit ? clean : `${clean.slice(0, limit)}…`;
}

/** @param {string | undefined} logPath */
function normalizeLogPath(logPath) {
  return resolve(logPath || process.env.REVIEWREADY_FAILURE_LOG || DEFAULT_LOG_NAME);
}

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {FailureEvent} */
function parseFailureEvent(value) {
  if (!isRecord(value)) throw new Error("failure log event is not an object");
  if (
    value.schemaVersion !== SCHEMA_VERSION ||
    typeof value.event !== "string" ||
    typeof value.fingerprint !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    throw new Error("failure log event is unsupported");
  }
  if (value.event === "failure") {
    if (
      typeof value.failureClass !== "string" ||
      typeof value.impact !== "string" ||
      typeof value.stage !== "string" ||
      typeof value.next !== "string" ||
      typeof value.command !== "string" ||
      typeof value.symptom !== "string" ||
      typeof value.evidence !== "string" ||
      value.status !== "open" ||
      value.retryAllowed !== false
    ) {
      throw new Error("failure log failure event is malformed");
    }
    return /** @type {FailureEvent} */ (value);
  }
  if (value.event === "resolution") {
    if (typeof value.resolution !== "string" || value.status !== "resolved") {
      throw new Error("failure log resolution event is malformed");
    }
    return /** @type {FailureEvent} */ (value);
  }
  throw new Error("failure log event kind is unsupported");
}

/** @param {string} value @param {Set<string>} allowed @param {string} label */
function requireChoice(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`${label} is invalid`);
  return value;
}

/**
 * @param {{failureClass: string, stage: string, symptom: string, command: string}} value
 */
function fingerprintFor(value) {
  return createHash("sha256")
    .update(`${value.failureClass}\0${value.stage}\0${value.symptom}\0${value.command}`)
    .digest("hex")
    .slice(0, 24);
}

/**
 * @param {RecordFailureInput} input
 */
export function recordFailure(input) {
  const failureClass = requireChoice(input.failureClass, FAILURE_CLASSES, "failure class");
  const impact = requireChoice(input.impact, IMPACTS, "impact");
  const stage = requireChoice(input.stage, STAGES, "stage");
  const next = requireChoice(input.next, NEXT_ACTIONS, "next action");
  const command = bounded(input.command, MAX_COMMAND_LENGTH);
  const symptom = bounded(input.symptom, MAX_TEXT_LENGTH);
  const evidence = bounded(input.evidence, MAX_TEXT_LENGTH);
  const fingerprint = fingerprintFor({ command, failureClass, stage, symptom });
  const createdAt = new Date().toISOString();
  const event = {
    schemaVersion: SCHEMA_VERSION,
    event: "failure",
    id: `failure-${createdAt.replace(/\D/gu, "")}-${fingerprint}`,
    createdAt,
    failureClass,
    impact,
    stage,
    next,
    command,
    symptom,
    evidence,
    fingerprint,
    status: "open",
    retryAllowed: false
  };
  const path = normalizeLogPath(input.logPath);
  appendFileSync(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
  return event;
}

/** @param {string | undefined} logPath @returns {FailureEvent[]} */
function readEvents(logPath) {
  const path = normalizeLogPath(logPath);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/gu)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parsed = /** @type {unknown} */ (JSON.parse(line));
      return parseFailureEvent(parsed);
    });
}

/** @param {string} logPath */
export function triageFailures(logPath) {
  /** @type {Map<string, FailureGroup>} */
  const groups = new Map();
  for (const event of readEvents(logPath)) {
    if (event.event === "failure") {
      const current = groups.get(event.fingerprint) ?? {
        count: 0,
        failureClass: event.failureClass,
        fingerprint: event.fingerprint,
        firstSeen: event.createdAt,
        impact: event.impact,
        nextActions: new Set(),
        status: "open",
        symptoms: new Set(),
        lastSeen: event.createdAt
      };
      current.status = "open";
      delete current.resolution;
      delete current.resolvedAt;
      current.count += 1;
      current.lastSeen = event.createdAt;
      current.impact =
        (IMPACT_ORDER.get(event.impact) ?? 0) > (IMPACT_ORDER.get(current.impact) ?? 0)
          ? event.impact
          : current.impact;
      current.nextActions.add(event.next);
      current.symptoms.add(event.symptom);
      groups.set(event.fingerprint, current);
    } else {
      const current = groups.get(event.fingerprint);
      if (current !== undefined) {
        current.status = "resolved";
        current.resolution = event.resolution;
        current.resolvedAt = event.createdAt;
      }
    }
  }
  const allGroups = [...groups.values()].map((group) => ({
    ...group,
    nextActions: [...group.nextActions].sort(),
    symptoms: [...group.symptoms].sort()
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    totalGroups: allGroups.length,
    openGroups: allGroups.filter((group) => group.status === "open"),
    resolvedGroups: allGroups.filter((group) => group.status === "resolved"),
    nextBoundary: "repair-open-groups-before-promoting"
  };
}

/** @param {{fingerprint: string, logPath?: string, resolution: string}} input */
export function resolveFailure(input) {
  const triage = triageFailures(input.logPath);
  const group = [...triage.openGroups, ...triage.resolvedGroups].find(
    (candidate) => candidate.fingerprint === input.fingerprint
  );
  if (group === undefined) throw new Error("failure fingerprint is not in the log");
  const event = {
    schemaVersion: SCHEMA_VERSION,
    event: "resolution",
    id: `resolution-${new Date().toISOString().replace(/\D/gu, "")}-${input.fingerprint}`,
    createdAt: new Date().toISOString(),
    fingerprint: input.fingerprint,
    resolution: bounded(input.resolution, MAX_TEXT_LENGTH),
    status: "resolved"
  };
  appendFileSync(normalizeLogPath(input.logPath), `${JSON.stringify(event)}\n`, {
    encoding: "utf8",
    flag: "a"
  });
  return event;
}

/** @param {string[]} args @returns {Record<string, string>} */
function parseArgs(args) {
  /** @type {Record<string, string>} */
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--") || args[index + 1] === undefined) {
      throw new Error("arguments must use --name value");
    }
    const kebabPart =
      /**
       * @param {string} _match
       * @param {string} letter
       */ (_match, letter) => letter.toUpperCase();
    const name = key.slice(2).replace(/-([a-z])/gu, kebabPart);
    const value = args[index + 1];
    if (value === undefined) throw new Error(`missing value for ${key}`);
    values[name] = value;
    index += 1;
  }
  return values;
}

/** @param {Record<string, string>} values @param {string} name */
function requiredArg(values, name) {
  const value = values[name];
  if (value === undefined || value.length === 0) throw new Error(`missing --${name}`);
  return value;
}

export function main() {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "record") {
      const values = parseArgs(rest);
      process.stdout.write(
        `${JSON.stringify(
          recordFailure({
            command: requiredArg(values, "command"),
            evidence: requiredArg(values, "evidence"),
            failureClass: requiredArg(values, "failureClass"),
            impact: requiredArg(values, "impact"),
            logPath: values.log,
            next: requiredArg(values, "next"),
            stage: requiredArg(values, "stage"),
            symptom: requiredArg(values, "symptom")
          })
        )}\n`
      );
      return;
    }
    if (command === "triage") {
      process.stdout.write(
        `${JSON.stringify(triageFailures(requiredArg(parseArgs(rest), "log")), null, 2)}\n`
      );
      return;
    }
    if (command === "resolve") {
      const values = parseArgs(rest);
      process.stdout.write(
        `${JSON.stringify(
          resolveFailure({
            fingerprint: requiredArg(values, "fingerprint"),
            logPath: values.log,
            resolution: requiredArg(values, "resolution")
          })
        )}\n`
      );
      return;
    }
    throw new Error("command must be record, triage, or resolve");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "failure log error"}\n`);
    process.exitCode = 2;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
