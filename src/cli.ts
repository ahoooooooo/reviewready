#!/usr/bin/env node

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { auditRepository, renderAuditJson, renderAuditSarif, type AuditReport } from "./audit.js";
import { hydrateAuditEvidenceBundle } from "./audit-evidence-bundle.js";
import {
  AuditEvidenceCollectionError,
  buildAuditEvidenceBundle,
  createAuditEvidenceSnapshot,
  serializeAuditEvidenceBundle
} from "./audit-evidence-collection.js";
import { parseCanonicalJsonBytes } from "./audit-evidence.js";
import { evaluate } from "./engine.js";
import { escapeControlCharacters, InputError, PolicyError, ReviewReadyError } from "./errors.js";
import {
  CliFileError,
  classifyFileReadFailure,
  readBoundedBytes,
  readBoundedFile,
  type FileReadFailure
} from "./file-reader.js";
import { createGitHubAuditClient } from "./github-audit-api.js";
import {
  MAX_AUDIT_WORKFLOW_ROOTS,
  AuditCollectionFailure,
  collectRepositoryAuditEvidenceData,
  collectRepositoryAuditSnapshot
} from "./github-audit.js";
import { parsePolicy } from "./policy.js";
import { explainPolicy, renderJson, renderText } from "./report.js";

export interface CliIo {
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  readBytes?: (path: string) => Promise<Uint8Array>;
  stdout: (value: string) => void;
  stdoutBytes?: (value: Uint8Array) => void;
  stderr: (value: string) => void;
}

interface ParsedArguments {
  command: string | undefined;
  auditMode: "legacy" | "collect" | "replay";
  policy: string | undefined;
  input: string | undefined;
  bundle: string | undefined;
  bundleSha256: string | undefined;
  revision: string | undefined;
  github: string | undefined;
  ref: string | undefined;
  policyPath: string | undefined;
  tokenEnv: string | undefined;
  protectedWorkflowPaths: string[];
  trustedWorkflowPaths: string[];
  json: boolean;
  sarif: boolean;
}

const usage =
  "Usage: reviewready <validate|check|explain> --policy <path> [--input <path>] [--json]; reviewready audit --input <snapshot> [--json|--sarif]; reviewready audit collect --github <owner/repo> --revision <full-sha> [options]; reviewready audit replay --bundle <path> [--bundle-sha256 <sha256>] [--json|--sarif]";

const defaultIo: CliIo = {
  readFile: (path) => readBoundedFile(path),
  readBytes: (path) => readBoundedBytes(path),
  stdout: (value) => process.stdout.write(`${value}\n`),
  stdoutBytes: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(`${value}\n`)
};

function parseArguments(argv: readonly string[]): ParsedArguments {
  const [command, ...options] = argv;
  let auditMode: "legacy" | "collect" | "replay" = "legacy";
  let optionStart = 0;
  if (command === "audit" && (options[0] === "collect" || options[0] === "replay")) {
    auditMode = options[0];
    optionStart = 1;
  }
  let policy: string | undefined;
  let input: string | undefined;
  let bundle: string | undefined;
  let bundleSha256: string | undefined;
  let revision: string | undefined;
  let github: string | undefined;
  let ref: string | undefined;
  let policyPath: string | undefined;
  let tokenEnv: string | undefined;
  const protectedWorkflowPaths: string[] = [];
  const trustedWorkflowPaths: string[] = [];
  let json = false;
  let sarif = false;

  for (let index = optionStart; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--json") {
      json = true;
      continue;
    }
    if (option === "--sarif") {
      sarif = true;
      continue;
    }
    if (
      option !== "--policy" &&
      option !== "--input" &&
      option !== "--bundle" &&
      option !== "--bundle-sha256" &&
      option !== "--revision" &&
      option !== "--github" &&
      option !== "--ref" &&
      option !== "--policy-path" &&
      option !== "--token-env" &&
      option !== "--protected-workflow" &&
      option !== "--trusted-workflow"
    ) {
      throw new InputError("CLI_USAGE", `Unknown option "${option ?? ""}". ${usage}`);
    }

    const value = options[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new InputError("CLI_USAGE", `Option "${option}" requires a path. ${usage}`);
    }
    if (option === "--github") {
      if (github !== undefined) {
        throw new InputError("CLI_USAGE", 'Option "--github" may be provided only once.');
      }
      github = value;
    } else if (option === "--bundle") {
      if (bundle !== undefined) {
        throw new InputError("CLI_USAGE", 'Option "--bundle" may be provided only once.');
      }
      bundle = value;
    } else if (option === "--bundle-sha256") {
      if (bundleSha256 !== undefined) {
        throw new InputError("CLI_USAGE", 'Option "--bundle-sha256" may be provided only once.');
      }
      bundleSha256 = value;
    } else if (option === "--revision") {
      if (revision !== undefined) {
        throw new InputError("CLI_USAGE", 'Option "--revision" may be provided only once.');
      }
      revision = value;
    } else if (option === "--ref") {
      if (ref !== undefined) {
        throw new InputError("CLI_USAGE", 'Option "--ref" may be provided only once.');
      }
      ref = value;
    } else if (option === "--policy-path") {
      if (policyPath !== undefined) {
        throw new InputError("CLI_USAGE", 'Option "--policy-path" may be provided only once.');
      }
      policyPath = value;
    } else if (option === "--token-env") {
      if (tokenEnv !== undefined) {
        throw new InputError("CLI_USAGE", 'Option "--token-env" may be provided only once.');
      }
      tokenEnv = value;
    } else if (option === "--protected-workflow") {
      if (protectedWorkflowPaths.length >= MAX_AUDIT_WORKFLOW_ROOTS) {
        throw new InputError("CLI_USAGE", "The workflow root limit was exceeded.");
      }
      protectedWorkflowPaths.push(value);
    } else if (option === "--trusted-workflow") {
      if (trustedWorkflowPaths.length >= MAX_AUDIT_WORKFLOW_ROOTS) {
        throw new InputError("CLI_USAGE", "The workflow root limit was exceeded.");
      }
      trustedWorkflowPaths.push(value);
    } else if (option === "--policy") {
      if (policy !== undefined) {
        throw new InputError("CLI_USAGE", 'Option "--policy" may be provided only once.');
      }
      policy = value;
    } else {
      if (input !== undefined) {
        throw new InputError("CLI_USAGE", 'Option "--input" may be provided only once.');
      }
      input = value;
    }
    index += 1;
  }

  return {
    command,
    auditMode,
    policy,
    input,
    bundle,
    bundleSha256,
    revision,
    github,
    ref,
    policyPath,
    tokenEnv,
    protectedWorkflowPaths,
    trustedWorkflowPaths,
    json,
    sarif
  };
}

function requiredPath(value: string | undefined, option: "--policy" | "--input"): string {
  if (value === undefined) {
    throw new InputError("CLI_USAGE", `Missing required option ${option}. ${usage}`);
  }
  return value;
}

function validateCommandOptions(parsed: ParsedArguments): void {
  if (
    parsed.command !== "audit" &&
    (parsed.bundle !== undefined ||
      parsed.bundleSha256 !== undefined ||
      parsed.revision !== undefined)
  ) {
    throw new InputError(
      "CLI_USAGE",
      "Audit bundle options are only valid with the audit command."
    );
  }
  if (parsed.command === "audit" && parsed.policy !== undefined) {
    throw new InputError("CLI_USAGE", 'Option "--policy" is not valid with the audit command.');
  }
  if (parsed.command === "audit" && parsed.auditMode === "replay") {
    if (parsed.bundle === undefined) {
      throw new InputError("CLI_USAGE", 'Audit replay requires "--bundle".');
    }
    if (parsed.bundleSha256 !== undefined && !/^[0-9a-f]{64}$/iu.test(parsed.bundleSha256)) {
      throw new InputError(
        "CLI_USAGE",
        'Option "--bundle-sha256" requires a 64-character SHA-256.'
      );
    }
    if (
      parsed.input !== undefined ||
      parsed.github !== undefined ||
      parsed.revision !== undefined ||
      parsed.ref !== undefined ||
      parsed.policyPath !== undefined ||
      parsed.tokenEnv !== undefined ||
      parsed.protectedWorkflowPaths.length > 0 ||
      parsed.trustedWorkflowPaths.length > 0
    ) {
      throw new InputError(
        "CLI_USAGE",
        "Audit replay accepts only --bundle, --bundle-sha256, and an output renderer."
      );
    }
  }
  if (parsed.command === "audit" && parsed.auditMode === "collect") {
    if (parsed.github === undefined || parsed.revision === undefined) {
      throw new InputError("CLI_USAGE", 'Audit collect requires "--github" and "--revision".');
    }
    if (!/^[0-9a-f]{40}$/iu.test(parsed.revision)) {
      throw new InputError("CLI_USAGE", "Audit collect requires a full 40-character revision SHA.");
    }
    if (
      parsed.input !== undefined ||
      parsed.bundle !== undefined ||
      parsed.bundleSha256 !== undefined ||
      parsed.ref !== undefined
    ) {
      throw new InputError(
        "CLI_USAGE",
        "Audit collect does not accept --input, --bundle, or --ref."
      );
    }
    if (parsed.json || parsed.sarif) {
      throw new InputError(
        "CLI_USAGE",
        "Audit collect emits canonical bundle bytes without a renderer."
      );
    }
  }
  if (
    parsed.command === "audit" &&
    parsed.auditMode === "legacy" &&
    (parsed.bundle !== undefined ||
      parsed.bundleSha256 !== undefined ||
      parsed.revision !== undefined)
  ) {
    throw new InputError("CLI_USAGE", "Use audit collect or audit replay for bundle options.");
  }
  if (parsed.command === "audit" && parsed.auditMode !== "legacy") {
    if (parsed.sarif && parsed.json) {
      throw new InputError("CLI_USAGE", 'Options "--json" and "--sarif" are mutually exclusive.');
    }
    return;
  }
  const auditOptions =
    parsed.github !== undefined ||
    parsed.ref !== undefined ||
    parsed.policyPath !== undefined ||
    parsed.tokenEnv !== undefined ||
    parsed.protectedWorkflowPaths.length > 0 ||
    parsed.trustedWorkflowPaths.length > 0;
  if (parsed.command !== "audit" && auditOptions) {
    throw new InputError("CLI_USAGE", "Live audit options are only valid with the audit command.");
  }
  if (parsed.command === "audit" && parsed.github !== undefined && parsed.input !== undefined) {
    throw new InputError("CLI_USAGE", 'Options "--github" and "--input" are mutually exclusive.');
  }
  if (parsed.command === "audit" && parsed.github === undefined && auditOptions) {
    throw new InputError("CLI_USAGE", "Live audit options require --github.");
  }
  if (parsed.command === "audit" && parsed.github === undefined && parsed.input === undefined) {
    throw new InputError("CLI_USAGE", 'Audit requires either "--input" or "--github".');
  }
  if (parsed.command !== "check" && parsed.command !== "audit" && parsed.input !== undefined) {
    throw new InputError("CLI_USAGE", 'Option "--input" is only valid with the check command.');
  }
  if (parsed.command !== "check" && parsed.command !== "audit" && parsed.json) {
    throw new InputError("CLI_USAGE", 'Option "--json" is only valid with the check command.');
  }
  if (parsed.command !== "audit" && parsed.sarif) {
    throw new InputError("CLI_USAGE", 'Option "--sarif" is only valid with the audit command.');
  }
  if (parsed.command === "audit" && parsed.json && parsed.sarif) {
    throw new InputError("CLI_USAGE", 'Options "--json" and "--sarif" are mutually exclusive.');
  }
}

function githubTarget(value: string): { readonly owner: string; readonly repo: string } {
  const parts = value.split("/");
  if (
    parts.length !== 2 ||
    parts.some((part) => part.length === 0 || part.length > 100 || !/^[A-Za-z0-9._-]+$/u.test(part))
  ) {
    throw new InputError(
      "CLI_USAGE",
      'The live audit target must use the bounded "owner/repo" form.'
    );
  }
  return { owner: parts[0] as string, repo: parts[1] as string };
}

function tokenEnvironmentName(value: string | undefined): string {
  const name = value ?? "GITHUB_TOKEN";
  if (!/^[A-Z_][A-Z0-9_]{0,127}$/u.test(name)) {
    throw new InputError("CLI_USAGE", "The token environment name is invalid.");
  }
  return name;
}

async function readPolicy(path: string, io: CliIo): Promise<ReturnType<typeof parsePolicy>> {
  return parsePolicy(await readCliFile(path, "policy", io));
}

function readError(
  kind: "policy" | "input" | "bundle",
  failure: FileReadFailure
): ReviewReadyError {
  const noun = kind === "policy" ? "Policy" : kind === "input" ? "Input" : "Audit bundle";
  const ErrorType = kind === "policy" ? PolicyError : InputError;
  switch (failure) {
    case "not_found":
      return new ErrorType(
        kind === "policy"
          ? "POLICY_FILE_NOT_FOUND"
          : kind === "input"
            ? "INPUT_FILE_NOT_FOUND"
            : "AUDIT_BUNDLE_FILE_NOT_FOUND",
        noun + " file was not found."
      );
    case "access_denied":
      return new ErrorType(
        kind === "policy"
          ? "POLICY_FILE_ACCESS_DENIED"
          : kind === "input"
            ? "INPUT_FILE_ACCESS_DENIED"
            : "AUDIT_BUNDLE_FILE_ACCESS_DENIED",
        noun + " file could not be read because access was denied."
      );
    case "not_regular":
      return new ErrorType(
        kind === "policy"
          ? "POLICY_FILE_NOT_REGULAR"
          : kind === "input"
            ? "INPUT_FILE_NOT_REGULAR"
            : "AUDIT_BUNDLE_FILE_NOT_REGULAR",
        noun + " file must be a regular file."
      );
    case "too_large":
      return new ErrorType(
        kind === "policy"
          ? "POLICY_FILE_TOO_LARGE"
          : kind === "input"
            ? "INPUT_FILE_TOO_LARGE"
            : "AUDIT_BUNDLE_FILE_TOO_LARGE",
        noun + " file exceeds the CLI raw-byte limit."
      );
    case "read_failed":
      return new ErrorType(
        kind === "policy"
          ? "POLICY_FILE_READ_FAILED"
          : kind === "input"
            ? "INPUT_FILE_READ_FAILED"
            : "AUDIT_BUNDLE_FILE_READ_FAILED",
        noun + " file could not be read."
      );
  }
}

async function readCliFile(path: string, kind: "policy" | "input", io: CliIo): Promise<string> {
  try {
    return await io.readFile(path, "utf8");
  } catch (error) {
    const hasErrnoCode =
      typeof error === "object" &&
      error !== null &&
      typeof (error as NodeJS.ErrnoException).code === "string";
    if (error instanceof CliFileError || hasErrnoCode) {
      throw readError(kind, classifyFileReadFailure(error));
    }
    throw error;
  }
}

async function readCliBundle(path: string, io: CliIo): Promise<Uint8Array> {
  try {
    return await (io.readBytes ?? ((value: string) => readBoundedBytes(value)))(path);
  } catch (error) {
    const hasErrnoCode =
      typeof error === "object" &&
      error !== null &&
      typeof (error as NodeJS.ErrnoException).code === "string";
    if (error instanceof CliFileError || hasErrnoCode) {
      throw readError("bundle", classifyFileReadFailure(error));
    }
    throw error;
  }
}

function parseJson(source: string, subject = "Pull-request input"): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new InputError("INPUT_JSON_INVALID", subject + " is not valid JSON.", {
      cause: error
    });
  }
}

function renderAuditText(report: AuditReport): string {
  const lines = [`REPOSITORY AUDIT: ${report.status.toUpperCase()}`];
  for (const finding of report.findings) {
    const location =
      finding.path === undefined ? "" : ` (${escapeControlCharacters(finding.path)})`;
    lines.push(
      `${escapeControlCharacters(finding.severity.toUpperCase())} ${escapeControlCharacters(finding.code)}${location}: ${escapeControlCharacters(finding.message)}`
    );
  }
  return lines.join("\n");
}

function mapAuditEvidenceCollectionError(error: unknown): InputError | undefined {
  if (
    !(error instanceof AuditCollectionFailure) &&
    !(error instanceof AuditEvidenceCollectionError)
  ) {
    return undefined;
  }
  if (error.code === "evidence-unsupported-semantics") {
    return new InputError(
      "AUDIT_EVIDENCE_UNSUPPORTED_SEMANTICS",
      "The remote audit contains security semantics not represented by evidence bundle v1; collection stopped closed."
    );
  }
  if (error.code === "evidence-revision-not-stable") {
    return new InputError(
      "AUDIT_EVIDENCE_REVISION_UNSTABLE",
      "The remote audit did not remain bound to one repository revision; collection stopped closed."
    );
  }
  return new InputError(
    "AUDIT_EVIDENCE_COLLECTION_FAILED",
    "Audit evidence collection failed closed."
  );
}

export async function runCli(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  try {
    const parsed = parseArguments(argv);
    validateCommandOptions(parsed);

    switch (parsed.command) {
      case "audit": {
        if (parsed.auditMode === "replay") {
          const bundlePath = parsed.bundle as string;
          let report: AuditReport;
          try {
            const bundleBytes = await readCliBundle(bundlePath, io);
            if (
              parsed.bundleSha256 !== undefined &&
              createHash("sha256").update(bundleBytes).digest("hex") !==
                parsed.bundleSha256.toLowerCase()
            ) {
              throw new InputError(
                "AUDIT_BUNDLE_INVALID",
                "Audit evidence bundle digest mismatch."
              );
            }
            const bundle = parseCanonicalJsonBytes(bundleBytes);
            report = hydrateAuditEvidenceBundle(bundle).report;
          } catch (error) {
            if (error instanceof ReviewReadyError) {
              throw error;
            }
            throw new InputError(
              "AUDIT_BUNDLE_INVALID",
              "Audit evidence bundle failed validation or replay."
            );
          }
          io.stdout(
            parsed.sarif
              ? renderAuditSarif(report)
              : parsed.json
                ? renderAuditJson(report, true)
                : renderAuditText(report)
          );
          return report.status === "pass" ? 0 : report.status === "fail" ? 1 : 2;
        }
        let report: AuditReport;
        if (parsed.github !== undefined) {
          const target = githubTarget(parsed.github);
          const environmentName = tokenEnvironmentName(parsed.tokenEnv);
          const token = process.env[environmentName];
          if (token === undefined || token.length === 0) {
            throw new InputError(
              "CLI_GITHUB_TOKEN_MISSING",
              `Live audit requires a token in environment variable ${environmentName}.`
            );
          }
          if (token.length > 16_384) {
            throw new InputError(
              "CLI_GITHUB_TOKEN_INVALID",
              "The GitHub token environment variable exceeds the supported size."
            );
          }
          const client = createGitHubAuditClient(token);
          if (parsed.auditMode === "collect") {
            if (io.stdoutBytes === undefined) {
              throw new InputError(
                "AUDIT_RAW_OUTPUT_UNAVAILABLE",
                "Audit collect requires a raw stdout sink."
              );
            }
            const startedAt = performance.now();
            let evidence;
            try {
              evidence = await collectRepositoryAuditEvidenceData(
                target.owner,
                target.repo,
                client,
                {
                  revision: parsed.revision as string,
                  ...(parsed.policyPath === undefined ? {} : { policyPath: parsed.policyPath }),
                  protectedWorkflowPaths: parsed.protectedWorkflowPaths,
                  trustedWorkflowPaths: parsed.trustedWorkflowPaths
                }
              );
              const durationMs = Math.max(0, Math.ceil(performance.now() - startedAt));
              const bundle = buildAuditEvidenceBundle({
                repository: evidence.repository,
                initialBranchSha: evidence.initialBranchSha,
                endingBranchSha: evidence.endingBranchSha,
                snapshot: createAuditEvidenceSnapshot(evidence.snapshot),
                policySource: evidence.policySource,
                workflowSources: evidence.snapshot.workflows.map(({ path, source }) => ({
                  path,
                  source
                })),
                protectedWorkflowPaths: parsed.protectedWorkflowPaths,
                trustedWorkflowPaths: parsed.trustedWorkflowPaths,
                observedAt: new Date().toISOString(),
                durationMs,
                requestAttempts: evidence.requestAttempts,
                retryAttempts: evidence.retryAttempts
              });
              report = hydrateAuditEvidenceBundle(bundle).report;
              const bytes = serializeAuditEvidenceBundle(bundle);
              io.stdoutBytes(bytes);
            } catch (error) {
              if (error instanceof ReviewReadyError) {
                throw error;
              }
              const mappedError = mapAuditEvidenceCollectionError(error);
              if (mappedError !== undefined) {
                throw mappedError;
              }
              throw new InputError(
                "AUDIT_EVIDENCE_COLLECTION_FAILED",
                "Audit evidence collection failed closed."
              );
            }
            return report.status === "pass" ? 0 : report.status === "fail" ? 1 : 2;
          }
          const snapshot = await collectRepositoryAuditSnapshot(target.owner, target.repo, client, {
            ...(parsed.ref === undefined ? {} : { branch: parsed.ref }),
            ...(parsed.policyPath === undefined ? {} : { policyPath: parsed.policyPath }),
            protectedWorkflowPaths: parsed.protectedWorkflowPaths,
            trustedWorkflowPaths: parsed.trustedWorkflowPaths
          });
          report = auditRepository(snapshot);
        } else {
          const inputPath = requiredPath(parsed.input, "--input");
          const input = parseJson(await readCliFile(inputPath, "input", io), "Audit input");
          report = auditRepository(input);
        }
        io.stdout(
          parsed.sarif
            ? renderAuditSarif(report)
            : parsed.json
              ? renderAuditJson(report, true)
              : renderAuditText(report)
        );
        return report.status === "pass" ? 0 : report.status === "fail" ? 1 : 2;
      }
      case "validate":
      case "check":
      case "explain":
        break;
      default:
        throw new InputError("CLI_USAGE", `Unknown or missing command. ${usage}`);
    }

    const policyPath = requiredPath(parsed.policy, "--policy");
    switch (parsed.command) {
      case "validate":
        await readPolicy(policyPath, io);
        io.stdout("Policy is valid (version 1).");
        return 0;
      case "check": {
        const inputPath = requiredPath(parsed.input, "--input");
        const [policySource, inputSource] = await Promise.all([
          readCliFile(policyPath, "policy", io),
          readCliFile(inputPath, "input", io)
        ]);
        const input = parseJson(inputSource);
        const result = evaluate(parsePolicy(policySource), input);
        io.stdout(parsed.json ? renderJson(result, true) : renderText(result));
        return result.status === "ready" ? 0 : 1;
      }
      case "explain": {
        const policy = await readPolicy(policyPath, io);
        io.stdout(explainPolicy(policy));
        return 0;
      }
      default:
        throw new InputError("CLI_USAGE", `Unknown or missing command. ${usage}`);
    }
  } catch (error) {
    if (error instanceof ReviewReadyError) {
      io.stderr(
        `[${escapeControlCharacters(error.code)}] ${escapeControlCharacters(error.message)}`
      );
      return error.exitCode;
    }
    io.stderr("[INTERNAL_ERROR] ReviewReady could not complete the command.");
    return 2;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
