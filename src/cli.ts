#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { auditRepository, renderAuditJson, renderAuditSarif, type AuditReport } from "./audit.js";
import { evaluate } from "./engine.js";
import { escapeControlCharacters, InputError, PolicyError, ReviewReadyError } from "./errors.js";
import {
  CliFileError,
  classifyFileReadFailure,
  readBoundedFile,
  type FileReadFailure
} from "./file-reader.js";
import { createGitHubAuditClient } from "./github-audit-api.js";
import { collectRepositoryAuditSnapshot } from "./github-audit.js";
import { parsePolicy } from "./policy.js";
import { explainPolicy, renderJson, renderText } from "./report.js";

export interface CliIo {
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

interface ParsedArguments {
  command: string | undefined;
  policy: string | undefined;
  input: string | undefined;
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
  "Usage: reviewready <validate|check|explain> --policy <path> [--input <path>] [--json]; reviewready audit --input <snapshot> [--json|--sarif]; reviewready audit --github <owner/repo> [--ref <branch>] [--policy-path <path>] [--token-env <name>] [--protected-workflow <path>] [--trusted-workflow <path>] [--json|--sarif]";

const defaultIo: CliIo = {
  readFile: (path) => readBoundedFile(path),
  stdout: (value) => process.stdout.write(`${value}\n`),
  stderr: (value) => process.stderr.write(`${value}\n`)
};

function parseArguments(argv: readonly string[]): ParsedArguments {
  const [command, ...options] = argv;
  let policy: string | undefined;
  let input: string | undefined;
  let github: string | undefined;
  let ref: string | undefined;
  let policyPath: string | undefined;
  let tokenEnv: string | undefined;
  const protectedWorkflowPaths: string[] = [];
  const trustedWorkflowPaths: string[] = [];
  let json = false;
  let sarif = false;

  for (let index = 0; index < options.length; index += 1) {
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
      protectedWorkflowPaths.push(value);
    } else if (option === "--trusted-workflow") {
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
    policy,
    input,
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
  if (parsed.command === "audit" && parsed.policy !== undefined) {
    throw new InputError("CLI_USAGE", 'Option "--policy" is not valid with the audit command.');
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

function readError(kind: "policy" | "input", failure: FileReadFailure): ReviewReadyError {
  const noun = kind === "policy" ? "Policy" : "Input";
  const ErrorType = kind === "policy" ? PolicyError : InputError;
  switch (failure) {
    case "not_found":
      return new ErrorType(
        kind === "policy" ? "POLICY_FILE_NOT_FOUND" : "INPUT_FILE_NOT_FOUND",
        noun + " file was not found."
      );
    case "access_denied":
      return new ErrorType(
        kind === "policy" ? "POLICY_FILE_ACCESS_DENIED" : "INPUT_FILE_ACCESS_DENIED",
        noun + " file could not be read because access was denied."
      );
    case "not_regular":
      return new ErrorType(
        kind === "policy" ? "POLICY_FILE_NOT_REGULAR" : "INPUT_FILE_NOT_REGULAR",
        noun + " file must be a regular file."
      );
    case "too_large":
      return new ErrorType(
        kind === "policy" ? "POLICY_FILE_TOO_LARGE" : "INPUT_FILE_TOO_LARGE",
        noun + " file exceeds the CLI raw-byte limit."
      );
    case "read_failed":
      return new ErrorType(
        kind === "policy" ? "POLICY_FILE_READ_FAILED" : "INPUT_FILE_READ_FAILED",
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

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new InputError("INPUT_JSON_INVALID", "Pull-request input is not valid JSON.", {
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

export async function runCli(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  try {
    const parsed = parseArguments(argv);
    validateCommandOptions(parsed);

    switch (parsed.command) {
      case "audit": {
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
          const client = createGitHubAuditClient(token);
          const snapshot = await collectRepositoryAuditSnapshot(target.owner, target.repo, client, {
            ...(parsed.ref === undefined ? {} : { branch: parsed.ref }),
            ...(parsed.policyPath === undefined ? {} : { policyPath: parsed.policyPath }),
            protectedWorkflowPaths: parsed.protectedWorkflowPaths,
            trustedWorkflowPaths: parsed.trustedWorkflowPaths
          });
          report = auditRepository(snapshot);
        } else {
          const inputPath = requiredPath(parsed.input, "--input");
          const input = parseJson(await readCliFile(inputPath, "input", io));
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
