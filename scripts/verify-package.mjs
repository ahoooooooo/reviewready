#!/usr/bin/env node
// @ts-check

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** @typedef {{ path: string, content: string }} PackageAuditEntry */

const REQUIRED_FILES = [
  "LICENSE",
  "README.md",
  "package.json",
  "reviewready.schema.json",
  "dist/cli.js",
  "dist/cli.d.ts"
];

const EXACT_ALLOWED_FILES = new Set([
  "LICENSE",
  "README.md",
  "package.json",
  "reviewready.schema.json"
]);

/** @type {Array<readonly [string, RegExp]>} */
const SENSITIVE_CONTENT = [
  ["email address", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu],
  ["Windows user path", /\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s]+/u],
  ["POSIX user path", /\/(?:home|Users)\/[^/\s]+/u],
  ["private key", /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/u],
  ["GitHub token", /\b(?:github_pat_[A-Za-z0-9_]{40,}|gh[pousr]_[A-Za-z0-9]{36,})\b/u],
  ["npm token", /\bnpm_[A-Za-z0-9]{36,}\b/u],
  ["OpenAI or Anthropic key", /\b(?:sk-ant-|sk-)[A-Za-z0-9_-]{20,}\b/u],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/u]
];

/**
 * @param {string} path
 * @returns {boolean}
 */
function isAllowedPath(path) {
  return EXACT_ALLOWED_FILES.has(path) || /^dist\/[^/]+\.(?:js|d\.ts)$/u.test(path);
}

/**
 * @param {PackageAuditEntry[]} entries
 * @returns {string[]}
 */
function auditPackageManifest(entries) {
  const entry = entries.find((candidate) => candidate.path === "package.json");
  if (!entry) {
    return [];
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(entry.content);
  } catch {
    return ["Packaged package.json is not valid JSON"];
  }
  if (typeof parsed !== "object" || parsed === null) {
    return ["Packaged package.json must contain an object"];
  }

  const manifest = /** @type {Record<string, unknown>} */ (parsed);
  const errors = [];
  if (manifest.name !== "@ahoooooo/reviewready") {
    errors.push("Packaged package name must be @ahoooooo/reviewready");
  }
  if (
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)
  ) {
    errors.push("Packaged package version must be valid semantic version text");
  }

  const publishConfig = manifest.publishConfig;
  if (typeof publishConfig !== "object" || publishConfig === null) {
    errors.push("Packaged package must declare public npm publishConfig");
  } else {
    const config = /** @type {Record<string, unknown>} */ (publishConfig);
    if (config.access !== "public" || config.registry !== "https://registry.npmjs.org") {
      errors.push("Packaged package must publish publicly to the official npm registry");
    }
  }

  for (const field of ["author", "contributors", "maintainers"]) {
    if (field in manifest) {
      errors.push(`Personal identity field is not allowed in packaged package.json: ${field}`);
    }
  }
  return errors;
}

/**
 * Audit the exact files npm plans to include.
 *
 * @param {PackageAuditEntry[]} entries
 * @returns {string[]}
 */
export function auditPackageEntries(entries) {
  const errors = [];
  const seen = new Set();

  for (const entry of entries) {
    if (seen.has(entry.path)) {
      errors.push(`Duplicate package file: ${entry.path}`);
      continue;
    }
    seen.add(entry.path);

    if (!isAllowedPath(entry.path)) {
      errors.push(`Unexpected package file: ${entry.path}`);
    }

    if (
      entry.path.includes("\\") ||
      entry.path.startsWith("/") ||
      entry.path.split("/").includes("..")
    ) {
      errors.push(`Unsafe package path: ${entry.path}`);
    }

    if (entry.content.includes("\0")) {
      errors.push(`Binary content is not allowed: ${entry.path}`);
      continue;
    }

    for (const [label, pattern] of SENSITIVE_CONTENT) {
      if (pattern.test(entry.content)) {
        errors.push(`Sensitive ${label} found in package file: ${entry.path}`);
      }
    }
  }

  for (const required of REQUIRED_FILES) {
    if (!seen.has(required)) {
      errors.push(`Missing required package file: ${required}`);
    }
  }

  errors.push(...auditPackageManifest(entries));
  return errors.sort();
}

/**
 * @param {unknown} value
 * @returns {value is { path: string }}
 */
function isPackFile(value) {
  if (typeof value !== "object" || value === null || !("path" in value)) {
    return false;
  }
  return typeof (/** @type {{ path?: unknown }} */ (value).path) === "string";
}

/**
 * @param {unknown} value
 * @returns {value is { files: Array<{ path: string }> }}
 */
function isPackResult(value) {
  if (typeof value !== "object" || value === null || !("files" in value)) {
    return false;
  }
  const files = /** @type {{ files?: unknown }} */ (value).files;
  return Array.isArray(files) && files.every(isPackFile);
}

/**
 * Normalize npm's legacy array output and current package-name-keyed output.
 *
 * @param {unknown} parsed
 * @returns {{ files: Array<{ path: string }> } | undefined}
 */
export function extractPackResult(parsed) {
  if (Array.isArray(parsed)) {
    return parsed.length === 1 && isPackResult(parsed[0]) ? parsed[0] : undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const values = Object.values(/** @type {Record<string, unknown>} */ (parsed));
  return values.length === 1 && isPackResult(values[0]) ? values[0] : undefined;
}

/**
 * @param {string} projectRoot
 * @returns {PackageAuditEntry[]}
 */
export function loadPlannedPackageEntries(projectRoot) {
  const npmCliPath = process.env.npm_execpath;
  if (!npmCliPath) {
    throw new Error("npm_execpath is unavailable; run this audit through npm run verify:package");
  }
  const output = execFileSync(
    process.execPath,
    [npmCliPath, "pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
  const parsed = /** @type {unknown} */ (JSON.parse(output));
  const packResult = extractPackResult(parsed);
  if (!packResult) {
    throw new Error("npm pack returned an unexpected manifest");
  }

  const rootPrefix = resolve(projectRoot) + sep;
  return packResult.files.map((file) => {
    const absolutePath = resolve(projectRoot, file.path);
    if (!absolutePath.startsWith(rootPrefix)) {
      throw new Error(`npm pack returned an unsafe path: ${file.path}`);
    }
    return { path: file.path.replaceAll("\\", "/"), content: readFileSync(absolutePath, "utf8") };
  });
}

function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const entries = loadPlannedPackageEntries(projectRoot);
  const errors = auditPackageEntries(entries);
  if (errors.length > 0) {
    for (const error of errors) {
      process.stderr.write(`${error}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Package audit passed for ${String(entries.length)} files.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
