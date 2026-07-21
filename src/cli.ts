#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { evaluate } from "./engine.js";
import { InputError, ReviewReadyError } from "./errors.js";
import { parsePolicy } from "./policy.js";
import { explainPolicy, renderText } from "./report.js";

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
  readFile: (path, encoding) => readFile(path, encoding),
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
  return parsePolicy(await io.readFile(path, "utf8"));
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
          io.readFile(policyPath, "utf8"),
          io.readFile(inputPath, "utf8")
        ]);
        const input = parseJson(inputSource);
        const result = evaluate(parsePolicy(policySource), input);
        io.stdout(parsed.json ? JSON.stringify(result, undefined, 2) : renderText(result));
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
