#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { evaluate } from "./engine.js";
import { InputError, PolicyError, ReviewReadyError } from "./errors.js";
import {
  CliFileError,
  classifyFileReadFailure,
  readBoundedFile,
  type FileReadFailure
} from "./file-reader.js";
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
  json: boolean;
}

const usage =
  "Usage: reviewready <validate|check|explain> --policy <path> [--input <path>] [--json]";

const defaultIo: CliIo = {
  readFile: (path) => readBoundedFile(path),
  stdout: (value) => process.stdout.write(`${value}\n`),
  stderr: (value) => process.stderr.write(`${value}\n`)
};

function parseArguments(argv: readonly string[]): ParsedArguments {
  const [command, ...options] = argv;
  let policy: string | undefined;
  let input: string | undefined;
  let json = false;

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--json") {
      json = true;
      continue;
    }
    if (option !== "--policy" && option !== "--input") {
      throw new InputError("CLI_USAGE", `Unknown option "${option ?? ""}". ${usage}`);
    }

    const value = options[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new InputError("CLI_USAGE", `Option "${option}" requires a path. ${usage}`);
    }
    if (option === "--policy") {
      policy = value;
    } else {
      input = value;
    }
    index += 1;
  }

  return { command, policy, input, json };
}

function requiredPath(value: string | undefined, option: "--policy" | "--input"): string {
  if (value === undefined) {
    throw new InputError("CLI_USAGE", `Missing required option ${option}. ${usage}`);
  }
  return value;
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

export async function runCli(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  try {
    const parsed = parseArguments(argv);
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
        throw new InputError(
          "CLI_USAGE",
          `Unknown or missing command "${parsed.command ?? ""}". ${usage}`
        );
    }
  } catch (error) {
    if (error instanceof ReviewReadyError) {
      io.stderr(`[${error.code}] ${error.message}`);
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
