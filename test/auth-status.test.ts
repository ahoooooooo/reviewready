import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { inspectAuthentication } from "../scripts/auth-status.mjs";

interface CommandResult {
  readonly status: number;
  readonly stderr: string;
  readonly stdout: string;
}

function result(status: number, stdout = "", stderr = ""): CommandResult {
  return { status, stderr, stdout };
}

function repositoryCommand(command: string, args: readonly string[]): CommandResult | undefined {
  const key = [command, ...args].join(" ");
  if (key === "git remote get-url origin") {
    return result(0, "https://github.com/ahoooooooo/reviewready.git\n");
  }
  if (key === "git config --get-all credential.helper") {
    return result(0, "manager\n");
  }
  return undefined;
}

describe("repository authentication status", () => {
  it("treats sandbox credential-store denial as connected-context required without retrying", () => {
    const runCommand = vi.fn((command: string, args: readonly string[]): CommandResult => {
      const configured = repositoryCommand(command, args);
      if (configured !== undefined) return configured;
      if (command === "whoami") return result(0, "runner\\codexsandboxoffline\n");
      throw new Error(`unexpected command: ${[command, ...args].join(" ")}`);
    });

    const status = inspectAuthentication({
      environment: { USERPROFILE: "C:\\Users\\runner" },
      probeGitHubCredential: true,
      projectRoot: process.cwd(),
      runCommand
    });

    expect(status).toMatchObject({
      contractVersion: 1,
      status: "configured",
      retryPolicy: { sameContextRetries: 0 },
      github: {
        apiAuthority: "connected-provider",
        authenticated: null,
        authority: "windows-git-credential-manager",
        credentialState: "connected_context_required",
        ghCli: "forbidden",
        retryAllowed: false
      },
      npm: {
        authenticated: null,
        configured: true,
        loginStatus: "not_applicable_trusted_publishing",
        localLogin: "irrelevant",
        publishAuthority: "github-actions-oidc-trusted-publishing",
        retryAllowed: false
      }
    });
    expect(runCommand.mock.calls).toHaveLength(3);
    expect(runCommand.mock.calls.some(([command]) => command === "gh" || command === "npm")).toBe(
      false
    );
    expect(
      runCommand.mock.calls.some(
        ([command, args]) => command === "git" && args.includes("credential-manager")
      )
    ).toBe(false);
  });

  it("probes the connected Windows credential store once and never exposes account names", () => {
    const runCommand = vi.fn((command: string, args: readonly string[]): CommandResult => {
      const configured = repositoryCommand(command, args);
      if (configured !== undefined) return configured;
      if (command === "whoami") return result(0, "runner\\maintainer\n");
      if ([command, ...args].join(" ") === "git credential-manager github list --no-ui") {
        return result(0, "maintainer-one\nmaintainer-two\n");
      }
      throw new Error(`unexpected command: ${[command, ...args].join(" ")}`);
    });

    const status = inspectAuthentication({
      environment: { USERPROFILE: "C:\\Users\\runner" },
      probeGitHubCredential: true,
      projectRoot: process.cwd(),
      runCommand
    });

    expect(status.github).toMatchObject({
      accountCount: 2,
      authenticated: true,
      credentialState: "available",
      probeAttempts: 1,
      retryAllowed: false
    });
    expect(JSON.stringify(status)).not.toContain("maintainer-one");
    expect(JSON.stringify(status)).not.toContain("maintainer-two");
    expect(
      runCommand.mock.calls.filter(
        ([command, args]) => command === "git" && args.includes("credential-manager")
      )
    ).toHaveLength(1);
  });

  it("fails closed after one unavailable GCM probe and does not fall back to GitHub CLI", () => {
    const runCommand = vi.fn((command: string, args: readonly string[]): CommandResult => {
      const configured = repositoryCommand(command, args);
      if (configured !== undefined) return configured;
      if (command === "whoami") return result(0, "runner\\maintainer\n");
      if ([command, ...args].join(" ") === "git credential-manager github list --no-ui") {
        return result(1, "", "credential store unavailable: private detail");
      }
      throw new Error(`unexpected command: ${[command, ...args].join(" ")}`);
    });

    const status = inspectAuthentication({
      environment: { USERPROFILE: "C:\\Users\\runner" },
      probeGitHubCredential: true,
      projectRoot: process.cwd(),
      runCommand
    });

    expect(status.github).toMatchObject({
      authenticated: null,
      credentialState: "context_unavailable",
      probeAttempts: 1,
      retryAllowed: false
    });
    expect(JSON.stringify(status)).not.toContain("private detail");
    expect(runCommand.mock.calls.some(([command]) => command === "gh")).toBe(false);
  });

  it("fails the repository contract when the protected OIDC workflow drifts", () => {
    const runCommand = vi.fn((command: string, args: readonly string[]): CommandResult => {
      const configured = repositoryCommand(command, args);
      if (configured !== undefined) return configured;
      if (command === "whoami") return result(0, "runner\\codexsandboxoffline\n");
      throw new Error(`unexpected command: ${[command, ...args].join(" ")}`);
    });
    const readText = (path: string): string => {
      const text = readFileSync(path, "utf8");
      return path.endsWith("release-publish.yml")
        ? text.replace("id-token: write", "id-token: none")
        : text;
    };

    const status = inspectAuthentication({
      environment: { USERPROFILE: "C:\\Users\\runner" },
      projectRoot: process.cwd(),
      readText,
      runCommand
    });

    expect(status).toMatchObject({
      status: "contract_invalid",
      npm: { configured: false, retryAllowed: false }
    });
    expect(runCommand.mock.calls.some(([command]) => command === "npm")).toBe(false);
  });

  it("fails closed when publishing controls are split across workflow jobs", () => {
    const runCommand = vi.fn((command: string, args: readonly string[]): CommandResult => {
      const configured = repositoryCommand(command, args);
      if (configured !== undefined) return configured;
      if (command === "whoami") return result(0, "runner\\codexsandboxoffline\n");
      throw new Error("unexpected command");
    });
    const readText = (path: string): string => {
      const text = readFileSync(path, "utf8");
      if (!path.endsWith("release-publish.yml")) return text;
      return text
        .replace("      id-token: write\n", "      id-token: none\n")
        .replace(
          "      contents: read\n      # upload-artifact",
          "      contents: read\n      id-token: write\n      # upload-artifact"
        );
    };

    const status = inspectAuthentication({
      environment: { USERPROFILE: "C:\\Users\\runner" },
      projectRoot: process.cwd(),
      readText,
      runCommand
    });

    expect(status).toMatchObject({
      status: "contract_invalid",
      npm: { configured: false, retryAllowed: false }
    });
  });
});
