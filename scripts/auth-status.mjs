import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse as parseYaml } from "yaml";

const MAX_COMMAND_MS = 10_000;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const CANONICAL_REMOTE = /^https:\/\/github\.com\/ahoooooooo\/reviewready(?:\.git)?\/?$/u;
const GCM_HELPERS = new Set(["manager", "manager-core"]);

/**
 * @typedef {{status: number, stderr: string, stdout: string}} CommandResult
 * @typedef {(command: string, args: readonly string[]) => CommandResult} CommandRunner
 * @typedef {(path: string) => string} TextReader
 */

/**
 * Run one bounded local command. This helper never retries.
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @returns {CommandResult}
 */
export function runLocalCommand(command, args) {
  const child = spawnSync(command, [...args], {
    encoding: "utf8",
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    timeout: MAX_COMMAND_MS,
    windowsHide: true
  });
  if (child.error !== undefined) {
    return { status: 1, stderr: "local-command-unavailable", stdout: "" };
  }
  return {
    status: child.status ?? 1,
    stderr: typeof child.stderr === "string" ? child.stderr : "",
    stdout: typeof child.stdout === "string" ? child.stdout : ""
  };
}

/** @param {string} value */
function nonEmptyLines(value) {
  return value
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** @param {string} identity */
function isSandboxIdentity(identity) {
  return /(?:^|\\)codexsandbox(?:offline|users)?$/iu.test(identity.trim());
}

/** @param {string | undefined} path */
function profileName(path) {
  return path?.split(/[\\/]/u).filter(Boolean).at(-1)?.toLocaleLowerCase("en-US") ?? null;
}

/**
 * @param {string} projectRoot
 * @param {TextReader} readText
 */
function inspectTrustedPublishing(projectRoot, readText) {
  try {
    const manifest = /** @type {unknown} */ (
      JSON.parse(readText(resolve(projectRoot, "package.json")))
    );
    const manifestRecord =
      typeof manifest === "object" && manifest !== null
        ? /** @type {Record<string, unknown>} */ (manifest)
        : {};
    const packageVersion =
      typeof manifestRecord.version === "string" ? manifestRecord.version : null;
    const evidence = /** @type {unknown} */ (
      JSON.parse(
        readText(
          resolve(projectRoot, "docs", `release-evidence-v${packageVersion ?? "invalid"}.json`)
        )
      )
    );
    const workflowText = readText(
      resolve(projectRoot, ".github", "workflows", "release-publish.yml")
    );
    const workflow = /** @type {unknown} */ (parseYaml(workflowText));
    const workflowRecord =
      typeof workflow === "object" && workflow !== null && !Array.isArray(workflow)
        ? /** @type {Record<string, unknown>} */ (workflow)
        : {};
    const jobs =
      typeof workflowRecord.jobs === "object" &&
      workflowRecord.jobs !== null &&
      !Array.isArray(workflowRecord.jobs)
        ? /** @type {Record<string, unknown>} */ (workflowRecord.jobs)
        : {};
    const publishJob =
      typeof jobs.publish === "object" && jobs.publish !== null && !Array.isArray(jobs.publish)
        ? /** @type {Record<string, unknown>} */ (jobs.publish)
        : {};
    const publishPermissions =
      typeof publishJob.permissions === "object" &&
      publishJob.permissions !== null &&
      !Array.isArray(publishJob.permissions)
        ? /** @type {Record<string, unknown>} */ (publishJob.permissions)
        : {};
    const publishSteps = /** @type {unknown[]} */ (
      Array.isArray(publishJob.steps) ? publishJob.steps : []
    );
    const hasWorkflowDispatch =
      typeof workflowRecord.on === "object" &&
      workflowRecord.on !== null &&
      !Array.isArray(workflowRecord.on) &&
      Object.hasOwn(workflowRecord.on, "workflow_dispatch");
    const hasProvenancePublish = publishSteps.some((step) => {
      if (typeof step !== "object" || step === null || Array.isArray(step)) return false;
      const stepRecord = /** @type {Record<string, unknown>} */ (step);
      return (
        typeof stepRecord.run === "string" &&
        /\bnpm\s+publish\b[\s\S]*--provenance\b/u.test(stepRecord.run)
      );
    });
    const packageName = manifestRecord.name;
    const evidenceRecord =
      typeof evidence === "object" && evidence !== null
        ? /** @type {Record<string, unknown>} */ (evidence)
        : {};
    const configured =
      packageName === "@ahoooooo/reviewready" &&
      hasWorkflowDispatch &&
      publishJob.if === "github.ref == 'refs/heads/main'" &&
      publishJob.environment === "release" &&
      publishPermissions.contents === "write" &&
      publishPermissions["id-token"] === "write" &&
      hasProvenancePublish &&
      !/NPM_TOKEN|NODE_AUTH_TOKEN/u.test(workflowText) &&
      evidenceRecord.packageName === "@ahoooooo/reviewready" &&
      evidenceRecord.version === packageVersion &&
      evidenceRecord.packageVersion === packageVersion &&
      evidenceRecord.provenanceRepository === "https://github.com/ahoooooooo/reviewready" &&
      evidenceRecord.provenanceWorkflow === ".github/workflows/release-publish.yml" &&
      evidenceRecord.provenanceRef === "refs/heads/main";
    return {
      configured,
      historicalEvidenceVersion:
        typeof evidenceRecord.version === "string" ? evidenceRecord.version : null
    };
  } catch {
    return { configured: false, historicalEvidenceVersion: null };
  }
}

/**
 * Inspect the repository's authentication contract without contacting GitHub or npm.
 * A connected Windows context may additionally inspect the local GCM account store
 * once. Account names and command errors are never returned.
 *
 * @param {{
 *   environment?: Record<string, string | undefined>,
 *   probeGitHubCredential?: boolean,
 *   projectRoot?: string,
 *   readText?: TextReader,
 *   runCommand?: CommandRunner
 * }} [options]
 */
export function inspectAuthentication(options = {}) {
  const projectRoot = resolve(
    options.projectRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..")
  );
  const runCommand = options.runCommand ?? runLocalCommand;
  const readText = options.readText ?? ((path) => readFileSync(path, "utf8"));
  const environment = options.environment ?? process.env;
  const probeGitHubCredential = options.probeGitHubCredential ?? true;

  const identityResult = runCommand("whoami", []);
  const identity = identityResult.status === 0 ? identityResult.stdout : "";
  const sandbox = isSandboxIdentity(identity);
  const identityName = identity.trim().split("\\").at(-1)?.toLocaleLowerCase("en-US");
  const inheritedProfileName = profileName(environment.USERPROFILE);
  const remoteResult = runCommand("git", ["remote", "get-url", "origin"]);
  const helperResult = runCommand("git", ["config", "--get-all", "credential.helper"]);
  const remote = remoteResult.status === 0 ? remoteResult.stdout.trim() : "";
  const helpers = helperResult.status === 0 ? nonEmptyLines(helperResult.stdout) : [];
  const githubConfigured =
    CANONICAL_REMOTE.test(remote) && helpers.some((helper) => GCM_HELPERS.has(helper));

  let credentialState = githubConfigured ? "configured_not_probed" : "contract_invalid";
  let probeAttempts = 0;
  let accountCount;
  if (githubConfigured && sandbox) {
    credentialState = "connected_context_required";
  } else if (githubConfigured && probeGitHubCredential) {
    probeAttempts = 1;
    const credentialResult = runCommand("git", ["credential-manager", "github", "list", "--no-ui"]);
    if (credentialResult.status === 0) {
      accountCount = nonEmptyLines(credentialResult.stdout).length;
      credentialState = accountCount > 0 ? "available" : "not_logged_in";
    } else {
      credentialState = "context_unavailable";
    }
  }

  const trustedPublishing = inspectTrustedPublishing(projectRoot, readText);
  const configured = githubConfigured && trustedPublishing.configured;
  return {
    contractVersion: 1,
    status: configured ? "configured" : "contract_invalid",
    retryPolicy: {
      maxCredentialStoreProbes: 1,
      sameContextRetries: 0
    },
    github: {
      authority: "windows-git-credential-manager",
      apiAuthority: "connected-provider",
      apiState: "operation_scoped",
      ghCli: "forbidden",
      configured: githubConfigured,
      executionContext: sandbox ? "sandbox" : "connected-user",
      credentialState,
      loginStatus: credentialState,
      authenticated:
        credentialState === "available" ? true : credentialState === "not_logged_in" ? false : null,
      probeAttempts,
      ...(accountCount === undefined ? {} : { accountCount }),
      retryAllowed: false,
      next:
        credentialState === "connected_context_required" ||
        credentialState === "context_unavailable"
          ? "stop-and-use-connected-context"
          : credentialState === "not_logged_in"
            ? "human-gcm-browser-login-required"
            : "use-gcm-for-git-and-connected-provider-for-api"
    },
    npm: {
      publishAuthority: "github-actions-oidc-trusted-publishing",
      localLogin: "irrelevant",
      loginStatus: "not_applicable_trusted_publishing",
      authenticated: null,
      npmLogin: "forbidden",
      npmWhoami: "forbidden",
      configured: trustedPublishing.configured,
      historicalEvidenceVersion: trustedPublishing.historicalEvidenceVersion,
      retryAllowed: false,
      next: "publish-only-through-protected-release-workflow"
    },
    context: {
      identityAvailable: identityResult.status === 0,
      inheritedProfileMismatch:
        identityName !== undefined &&
        inheritedProfileName !== null &&
        identityName !== inheritedProfileName
    }
  };
}

export function main() {
  const allowed = new Set(["--json", "--no-github-probe"]);
  const unknown = process.argv.slice(2).filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) {
    process.stderr.write("Usage: node scripts/auth-status.mjs [--json] [--no-github-probe]\n");
    process.exitCode = 2;
    return;
  }
  const status = inspectAuthentication({
    probeGitHubCredential: !process.argv.includes("--no-github-probe")
  });
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  if (status.status !== "configured") process.exitCode = 2;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
