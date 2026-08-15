#!/usr/bin/env node
// @ts-check

import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  opendirSync,
  readSync,
  rmSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

export const MAX_GENERATED_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_GENERATED_FILES = 4_096;
export const MAX_GENERATED_DIRECTORIES = 1_024;
export const MAX_GENERATED_TREE_BYTES = 256 * 1024 * 1024;
export const MAX_GENERATED_TREE_DEPTH = 32;
export const MAX_SOURCE_MAP_DEPTH = 32;
export const MAX_SOURCE_MAP_BYTES = 8 * 1024 * 1024;
export const MAX_SOURCE_MAP_RANGES = 65_536;
export const MAX_BUILD_PROCESS_MS = 120_000;
export const MAX_BUILD_OUTPUT_BYTES = 2 * 1024 * 1024;
const NO_FOLLOW = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is string[]} */
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** @param {unknown} value @returns {boolean} */
function isNonNegativeSafeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * @param {unknown} value
 * @param {number} depth
 * @returns {boolean}
 */
function isValidSourceMap(value, depth = 0) {
  if (depth > MAX_SOURCE_MAP_DEPTH || !isRecord(value) || value.version !== 3) {
    return false;
  }
  const hasSources = Object.prototype.hasOwnProperty.call(value, "sources");
  const hasSections = Object.prototype.hasOwnProperty.call(value, "sections");
  if (hasSources === hasSections) {
    return false;
  }
  if (hasSources) {
    if (!isStringArray(value.sources)) {
      return false;
    }
    if (
      (Object.prototype.hasOwnProperty.call(value, "mappings") &&
        typeof value.mappings !== "string") ||
      (Object.prototype.hasOwnProperty.call(value, "names") && !isStringArray(value.names)) ||
      (Object.prototype.hasOwnProperty.call(value, "file") && typeof value.file !== "string") ||
      (Object.prototype.hasOwnProperty.call(value, "sourceRoot") &&
        typeof value.sourceRoot !== "string") ||
      (Object.prototype.hasOwnProperty.call(value, "sourcesContent") &&
        (!Array.isArray(value.sourcesContent) ||
          value.sourcesContent.some((item) => item !== null && typeof item !== "string")))
    ) {
      return false;
    }
    return true;
  }
  if (!Array.isArray(value.sections)) {
    return false;
  }
  return value.sections.every((section) => {
    if (!isRecord(section) || !isRecord(section.offset) || !("map" in section)) {
      return false;
    }
    if (
      !isNonNegativeSafeInteger(section.offset.line) ||
      !isNonNegativeSafeInteger(section.offset.column)
    ) {
      return false;
    }
    return isValidSourceMap(section.map, depth + 1);
  });
}

/**
 * @param {string} source
 * @param {string} projectRoot
 * @param {string} [sourceBase]
 * @returns {string}
 */
function normalizeSourceIdentity(source, projectRoot, sourceBase) {
  const normalized = source.replaceAll("\\", "/");
  if (sourceBase !== undefined && !normalized.startsWith("file://")) {
    try {
      const sourcePath = resolve(sourceBase, normalized);
      const projectRelative = relative(resolve(projectRoot), sourcePath).replaceAll("\\", "/");
      if (projectRelative === "src" || projectRelative.startsWith("src/")) {
        return projectRelative;
      }
    } catch {
      return normalized;
    }
    return normalized;
  }
  if (normalized.startsWith("../src/")) {
    const candidate = normalized.slice("../".length);
    return candidate.split("/").includes("..") ? normalized : candidate;
  }
  if (normalized.startsWith("src/")) {
    return normalized;
  }
  if (normalized.startsWith("file://")) {
    try {
      const sourcePath = resolve(fileURLToPath(normalized));
      const projectRelative = relative(resolve(projectRoot), sourcePath).replaceAll("\\", "/");
      if (projectRelative === "src" || projectRelative.startsWith("src/")) {
        return projectRelative;
      }
    } catch {
      return normalized;
    }
  }
  return normalized;
}

/** @typedef {{start: number, end: number, replacement: string}} SourceRange */
/** @typedef {"map" | "section" | "generic"} JsonScanMode */

/** @param {string} text @param {number} index @returns {number} */
function skipJsonWhitespace(text, index) {
  while (index < text.length && /\s/u.test(text[index] ?? "")) {
    index += 1;
  }
  return index;
}

/** @param {string} text @param {number} start @returns {number} */
function scanJsonString(text, start) {
  if (text[start] !== '"') {
    throw new Error("source map string expected");
  }
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] === '"') {
      return index + 1;
    }
    index += 1;
  }
  throw new Error("source map string is unterminated");
}

/** @param {string} text @param {number} start @returns {number} */
function scanJsonNumber(text, start) {
  const match = text.slice(start).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u);
  if (match === null) {
    throw new Error("source map number expected");
  }
  return start + match[0].length;
}

/**
 * @param {string} text
 * @param {number} start
 * @param {number} depth
 * @param {SourceRange[]} ranges
 * @param {JsonScanMode} mode
 * @returns {number}
 */
function scanJsonValue(text, start, depth, ranges, mode) {
  if (depth > MAX_SOURCE_MAP_DEPTH) {
    throw new Error("source map depth limit");
  }
  const character = text[start];
  if (character === "{") {
    return scanJsonObject(text, start, depth + 1, ranges, mode);
  }
  if (character === "[") {
    return scanJsonArray(text, start, depth + 1, ranges, mode, false);
  }
  if (character === '"') {
    return scanJsonString(text, start);
  }
  if (character === "t" && text.startsWith("true", start)) {
    return start + 4;
  }
  if (character === "f" && text.startsWith("false", start)) {
    return start + 5;
  }
  if (character === "n" && text.startsWith("null", start)) {
    return start + 4;
  }
  if (character === "-" || (character !== undefined && /\d/u.test(character))) {
    return scanJsonNumber(text, start);
  }
  throw new Error("source map value expected");
}

/**
 * @param {string} text
 * @param {number} start
 * @param {number} depth
 * @param {SourceRange[]} ranges
 * @param {JsonScanMode} mode
 * @param {boolean} sourceArray
 * @returns {number}
 */
function scanJsonArray(text, start, depth, ranges, mode, sourceArray) {
  let index = skipJsonWhitespace(text, start + 1);
  if (text[index] === "]") {
    return index + 1;
  }
  while (index < text.length) {
    if (sourceArray && text[index] === '"') {
      const end = scanJsonString(text, index);
      const source = /** @type {unknown} */ (JSON.parse(text.slice(index, end)));
      if (typeof source === "string") {
        if (ranges.length >= MAX_SOURCE_MAP_RANGES) {
          throw new Error("source map source token limit");
        }
        ranges.push({
          start: index,
          end,
          replacement: JSON.stringify(source)
        });
      }
      index = end;
    } else {
      index = scanJsonValue(text, index, depth, ranges, sourceArray ? "generic" : mode);
    }
    index = skipJsonWhitespace(text, index);
    if (text[index] === "]") {
      return index + 1;
    }
    if (text[index] !== ",") {
      throw new Error("source map array separator expected");
    }
    index = skipJsonWhitespace(text, index + 1);
  }
  throw new Error("source map array is unterminated");
}

/**
 * @param {string} text
 * @param {number} start
 * @param {number} depth
 * @param {SourceRange[]} ranges
 * @param {JsonScanMode} mode
 * @returns {number}
 */
function scanJsonObject(text, start, depth, ranges, mode) {
  let index = skipJsonWhitespace(text, start + 1);
  if (text[index] === "}") {
    return index + 1;
  }
  const keys = new Set();
  while (index < text.length) {
    const keyEnd = scanJsonString(text, index);
    const key = /** @type {unknown} */ (JSON.parse(text.slice(index, keyEnd)));
    if (typeof key !== "string") {
      throw new Error("source map object key is invalid");
    }
    if (keys.has(key)) {
      throw new Error("source map object key is duplicated");
    }
    keys.add(key);
    index = skipJsonWhitespace(text, keyEnd);
    if (text[index] !== ":") {
      throw new Error("source map object separator expected");
    }
    index = skipJsonWhitespace(text, index + 1);
    if (mode === "map" && key === "sources" && text[index] === "[") {
      index = scanJsonArray(text, index, depth, ranges, "generic", true);
    } else if (mode === "map" && key === "sections" && text[index] === "[") {
      index = scanJsonArray(text, index, depth, ranges, "section", false);
    } else if (mode === "section" && key === "map" && text[index] === "{") {
      index = scanJsonValue(text, index, depth, ranges, "map");
    } else {
      index = scanJsonValue(text, index, depth, ranges, "generic");
    }
    index = skipJsonWhitespace(text, index);
    if (text[index] === "}") {
      return index + 1;
    }
    if (text[index] !== ",") {
      throw new Error("source map object separator expected");
    }
    index = skipJsonWhitespace(text, index + 1);
  }
  throw new Error("source map object is unterminated");
}

/**
 * Normalize TypeScript's known output-root-dependent source tokens while
 * preserving sourceRoot, mappings, and all unrelated source-map fields.
 *
 * @param {Buffer} bytes
 * @param {string} projectRoot
 * @param {string} [sourceBase]
 * @returns {Buffer}
 */
export function normalizeSourceMapBytes(bytes, projectRoot, sourceBase) {
  try {
    if (bytes.byteLength > MAX_SOURCE_MAP_BYTES) {
      return bytes;
    }
    if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return bytes;
    }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const ranges = /** @type {SourceRange[]} */ ([]);
    const start = skipJsonWhitespace(text, 0);
    const end = scanJsonValue(text, start, 0, ranges, "map");
    if (skipJsonWhitespace(text, end) !== text.length) {
      return bytes;
    }
    const parsed = /** @type {unknown} */ (JSON.parse(text));
    if (!isValidSourceMap(parsed)) {
      return bytes;
    }
    for (const range of ranges) {
      const source = /** @type {unknown} */ (JSON.parse(text.slice(range.start, range.end)));
      if (typeof source === "string") {
        range.replacement = JSON.stringify(
          normalizeSourceIdentity(source, projectRoot, sourceBase)
        );
      }
    }
    const chunks = /** @type {string[]} */ ([]);
    let cursor = 0;
    for (const range of ranges) {
      if (range.start < cursor || range.end < range.start) {
        throw new Error("source map source ranges are not ordered");
      }
      chunks.push(text.slice(cursor, range.start), range.replacement);
      cursor = range.end;
    }
    chunks.push(text.slice(cursor));
    const normalized = chunks.join("");
    return Buffer.from(normalized, "utf8");
  } catch {
    return bytes;
  }
}

/**
 * @param {import("node:fs").Stats} left
 * @param {import("node:fs").Stats} right
 * @returns {boolean}
 */
function sameFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

/**
 * @param {import("node:fs").Stats} left
 * @param {import("node:fs").Stats} right
 * @returns {boolean}
 */
function sameDirectory(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

/**
 * @param {string} absolute
 * @param {import("node:fs").Stats} expected
 * @returns {Buffer}
 */
export function readStableFile(absolute, expected) {
  const before = lstatSync(absolute);
  if (before.isSymbolicLink() || !before.isFile() || !sameFile(before, expected)) {
    throw new Error("generated output file changed during verification");
  }
  if (before.size > MAX_GENERATED_FILE_BYTES) {
    throw new Error("generated output file is too large");
  }
  const descriptor = openSync(absolute, constants.O_RDONLY | NO_FOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (opened.isSymbolicLink() || !opened.isFile() || !sameFile(opened, before)) {
      throw new Error("generated output file changed during verification");
    }
    if (opened.size > MAX_GENERATED_FILE_BYTES) {
      throw new Error("generated output file is too large");
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, null);
      if (count <= 0) {
        throw new Error("generated output file ended during verification");
      }
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (readSync(descriptor, extra, 0, 1, null) > 0) {
      throw new Error("generated output file grew during verification");
    }
    const afterDescriptor = fstatSync(descriptor);
    const afterPath = lstatSync(absolute);
    if (
      !sameFile(opened, afterDescriptor) ||
      afterPath.isSymbolicLink() ||
      !sameFile(opened, afterPath)
    ) {
      throw new Error("generated output file changed during verification");
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * @param {string} absolute
 * @param {string} name
 * @param {string} projectRoot
 * @param {import("node:fs").Stats} stats
 * @returns {string}
 */
function digestFile(absolute, name, projectRoot, stats) {
  const bytes = readStableFile(absolute, stats);
  const comparable = name.endsWith(".map")
    ? normalizeSourceMapBytes(bytes, projectRoot, dirname(absolute))
    : bytes;
  return createHash("sha256").update(comparable).digest("hex");
}

/**
 * @param {string} root
 * @returns {import("node:fs").Stats}
 */
function assertDirectory(root) {
  let stats;
  try {
    stats = lstatSync(root);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("generated directory is missing: " + root, { cause: error });
    }
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      stats.isSymbolicLink()
        ? "generated output root is a symlink: " + root
        : "generated output root is not a regular directory: " + root
    );
  }
  return stats;
}

/**
 * @param {string | Buffer} value
 * @returns {string}
 */
function decodeDirectoryEntryName(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!Buffer.isBuffer(value)) {
    throw new Error("generated output contains an invalid directory entry name");
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(value);
    if (!Buffer.from(decoded, "utf8").equals(value)) {
      throw new Error("directory entry name is not canonical UTF-8");
    }
    return decoded;
  } catch (error) {
    throw new Error("generated output contains a non-UTF-8 directory entry", { cause: error });
  }
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function directoryEntryNames(root) {
  const rootStats = assertDirectory(root);
  const names = [];
  const directory = opendirSync(root, {
    encoding: /** @type {BufferEncoding} */ ("buffer")
  });
  try {
    let entry = directory.readSync();
    while (entry !== null) {
      if (entry.isSymbolicLink()) {
        throw new Error("generated output contains a symlink");
      }
      names.push(decodeDirectoryEntryName(entry.name));
      if (names.length > MAX_GENERATED_FILES + MAX_GENERATED_DIRECTORIES) {
        throw new Error("generated output directory entry count exceeds bounds");
      }
      entry = directory.readSync();
    }
  } finally {
    directory.closeSync();
  }
  if (!sameDirectory(rootStats, assertDirectory(root))) {
    throw new Error("generated output directory changed during verification");
  }
  return names.sort();
}

/**
 * @param {string} root
 * @param {string} [prefix]
 * @param {string} [projectRoot]
 * @param {CollectionHooks} [hooks]
 * @returns {Map<string, string>}
 */
export function collectFiles(root, prefix = "", projectRoot = root, hooks = {}) {
  const state = { fileCount: 0, totalBytes: 0, directoryCount: 0 };
  const collected = collectFilesInternal(root, prefix, projectRoot, state, 0, hooks);
  revalidateDirectoryInventory(collected.observedDirectories);
  return collected.files;
}

/** @typedef {{afterDirectoryRead?: (directory: string) => void}} CollectionHooks */
/** @typedef {{absolute: string, digest: string, name: string, stats: import("node:fs").Stats}} ObservedFile */
/** @typedef {{absolute: string, entries: string[], stats: import("node:fs").Stats}} ObservedDirectory */
/** @typedef {{files: Map<string, string>, observedFiles: Map<string, ObservedFile>, observedDirectories: Map<string, ObservedDirectory>}} CollectedFiles */

/**
 * @param {string} root
 * @param {string} prefix
 * @param {string} projectRoot
 * @param {{fileCount: number, totalBytes: number, directoryCount: number}} state
 * @param {number} depth
 * @param {CollectionHooks} hooks
 * @returns {CollectedFiles}
 */
function collectFilesInternal(root, prefix, projectRoot, state, depth, hooks) {
  if (!existsSync(root)) {
    throw new Error(`generated directory is missing: ${root}`);
  }
  if (depth > MAX_GENERATED_TREE_DEPTH) {
    throw new Error(
      "generated output depth exceeds " + String(MAX_GENERATED_TREE_DEPTH) + ": " + root
    );
  }
  const rootStats = assertDirectory(root);
  state.directoryCount += 1;
  if (state.directoryCount > MAX_GENERATED_DIRECTORIES) {
    throw new Error(
      "generated output directory count exceeds " + String(MAX_GENERATED_DIRECTORIES)
    );
  }
  const files = /** @type {Map<string, string>} */ (new Map());
  const observedFiles = /** @type {Map<string, ObservedFile>} */ (new Map());
  const observedDirectories = /** @type {Map<string, ObservedDirectory>} */ (new Map());
  const observedEntries = /** @type {Set<string>} */ (new Set());
  const directory = opendirSync(root, {
    encoding: /** @type {BufferEncoding} */ ("buffer")
  });
  try {
    const openedRootStats = assertDirectory(root);
    if (!sameDirectory(rootStats, openedRootStats)) {
      throw new Error("generated output directory changed during verification");
    }
    let entry = directory.readSync();
    while (entry !== null) {
      const entryName = decodeDirectoryEntryName(entry.name);
      observedEntries.add(entryName);
      const absolute = join(root, entryName);
      const name = prefix === "" ? entryName : prefix + "/" + entryName;
      if (entry.isSymbolicLink()) {
        throw new Error("generated output contains a symlink: " + name);
      }
      if (entry.isDirectory()) {
        const child = collectFilesInternal(absolute, name, projectRoot, state, depth + 1, hooks);
        for (const [childName, childDigest] of child.files) {
          files.set(childName, childDigest);
        }
        for (const [childAbsolute, observed] of child.observedFiles) {
          observedFiles.set(childAbsolute, observed);
        }
        for (const [childAbsolute, observed] of child.observedDirectories) {
          observedDirectories.set(childAbsolute, observed);
        }
        entry = directory.readSync();
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`generated output contains a non-regular entry: ${name}`);
      }
      const stats = lstatSync(absolute);
      if (stats.size > MAX_GENERATED_FILE_BYTES) {
        throw new Error(`generated output is too large: ${name}`);
      }
      state.fileCount += 1;
      if (state.fileCount > MAX_GENERATED_FILES) {
        throw new Error("generated output file count exceeds " + String(MAX_GENERATED_FILES));
      }
      state.totalBytes += stats.size;
      if (state.totalBytes > MAX_GENERATED_TREE_BYTES) {
        throw new Error("generated output total size exceeds " + String(MAX_GENERATED_TREE_BYTES));
      }
      const digest = digestFile(absolute, name, projectRoot, stats);
      files.set(name, digest);
      observedFiles.set(absolute, { absolute, digest, name, stats });
      entry = directory.readSync();
    }
  } finally {
    directory.closeSync();
  }
  observedDirectories.set(root, {
    absolute: root,
    entries: [...observedEntries].sort(),
    stats: rootStats
  });
  hooks.afterDirectoryRead?.(root);
  const finalEntries = directoryEntryNames(root);
  const initialEntryList = [...observedEntries].sort();
  if (JSON.stringify(initialEntryList) !== JSON.stringify(finalEntries)) {
    throw new Error("generated output directory changed during verification");
  }
  const finalRootStats = assertDirectory(root);
  if (!sameDirectory(rootStats, finalRootStats)) {
    throw new Error("generated output directory changed during verification");
  }
  if (hooks.afterDirectoryRead !== undefined || depth === 0) {
    for (const observed of observedFiles.values()) {
      /** @type {import("node:fs").Stats} */
      let current;
      try {
        current = lstatSync(observed.absolute);
      } catch (error) {
        throw new Error("generated output file changed during verification", { cause: error });
      }
      if (
        current.isSymbolicLink() ||
        !current.isFile() ||
        !sameFile(observed.stats, current) ||
        current.size > MAX_GENERATED_FILE_BYTES
      ) {
        throw new Error("generated output file changed during verification");
      }
      const digest = digestFile(observed.absolute, observed.name, projectRoot, current);
      if (digest !== observed.digest) {
        throw new Error("generated output file changed during verification");
      }
    }
  }
  return { files, observedFiles, observedDirectories };
}

/**
 * @param {Map<string, ObservedDirectory>} observedDirectories
 * @returns {void}
 */
function revalidateDirectoryInventory(observedDirectories) {
  for (const observed of observedDirectories.values()) {
    let current;
    try {
      current = assertDirectory(observed.absolute);
    } catch (error) {
      throw new Error("generated output directory changed during verification", { cause: error });
    }
    if (!sameDirectory(observed.stats, current)) {
      throw new Error("generated output directory changed during verification");
    }
    const entries = directoryEntryNames(observed.absolute);
    if (JSON.stringify(observed.entries) !== JSON.stringify(entries)) {
      throw new Error("generated output directory changed during verification");
    }
  }
}

/**
 * @param {string} label
 * @param {Map<string, string>} actual
 * @param {Map<string, string>} expected
 * @returns {void}
 */
function assertSameTree(label, actual, expected) {
  const actualNames = [...actual.keys()].sort();
  const expectedNames = [...expected.keys()].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`${label} file inventory differs from a clean build`);
  }
  for (const name of expectedNames) {
    if (actual.get(name) !== expected.get(name)) {
      throw new Error(`${label} file differs from a clean build: ${name}`);
    }
  }
}

/**
 * @param {string} projectRoot
 * @param {string} tool
 * @param {string[]} args
 * @returns {void}
 */
function runLocalTool(projectRoot, tool, args) {
  const toolPath = {
    tsc: "typescript/bin/tsc",
    ncc: "@vercel/ncc/dist/ncc/cli.js"
  }[tool];
  if (toolPath === undefined) {
    throw new Error(`unsupported local build tool: ${tool}`);
  }
  execFileSync(process.execPath, [join(projectRoot, "node_modules", toolPath), ...args], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: MAX_BUILD_PROCESS_MS,
    maxBuffer: MAX_BUILD_OUTPUT_BYTES
  });
}

function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const temporaryRoot = mkdtempSync(join(tmpdir(), "reviewready-dist-parity-"));
  const expectedRoot = join(temporaryRoot, "root");
  const expectedAction = join(temporaryRoot, "action");
  try {
    runLocalTool(projectRoot, "tsc", ["-p", "tsconfig.build.json", "--outDir", expectedRoot]);
    runLocalTool(projectRoot, "ncc", [
      "build",
      "src/action.ts",
      "-o",
      expectedAction,
      "--minify",
      "--license",
      "licenses.txt"
    ]);

    const currentDist = join(projectRoot, "dist");
    const currentFiles = collectFiles(currentDist, "", projectRoot);
    const currentRoot = new Map(
      [...currentFiles].filter(([name]) => name !== "action" && !name.startsWith("action/"))
    );
    assertSameTree("root dist", currentRoot, collectFiles(expectedRoot, "", projectRoot));
    assertSameTree(
      "Action dist",
      collectFiles(join(currentDist, "action"), "", projectRoot),
      collectFiles(expectedAction, "", projectRoot)
    );
    process.stdout.write("Generated dist parity passed.\n");
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
