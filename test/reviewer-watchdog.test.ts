import { describe, expect, it } from "vitest";

import {
  createReviewerWatchdog,
  validateReviewerReport,
  validateWorkerCanary
} from "../scripts/reviewer-watchdog.mjs";

const report = [
  "REVIEWER_REPORT_V1",
  "surface=public-surface",
  "falsifier=The package allowlist omits a required public file.",
  "evidence=package.json",
  "missed_surface=none",
  "authority_gap=none",
  "recommendation=reopen"
].join("\n");

function hostClose(previousStatus: string, closed: boolean) {
  return (agentId: string) => ({
    source: "host-close-agent",
    agentId,
    previousStatus,
    closed
  });
}

describe("reviewer watchdog", () => {
  it("requires the exact worker canary sentinel", () => {
    expect(validateWorkerCanary("REVIEWER_CANARY_OK").status).toBe("passed");
    expect(() => validateWorkerCanary("ready")).toThrow("exact sentinel");
  });

  it("rejects malformed or off-scope reports", () => {
    expect(
      validateReviewerReport(report, { surface: "public-surface", artifactId: "package.json" })
    ).toMatchObject({
      surface: "public-surface",
      evidence: "package.json"
    });
    expect(() =>
      validateReviewerReport(report, { surface: "security", artifactId: "SECURITY.md" })
    ).toThrow("off-scope");
    expect(() =>
      validateReviewerReport(report.replace("evidence=package.json", "evidence=README.md"), {
        surface: "public-surface",
        artifactId: "package.json"
      })
    ).toThrow("outside the packet");
    expect(() =>
      validateReviewerReport(
        report.replace("evidence=package.json", "evidence=evil-package.json"),
        {
          surface: "public-surface",
          artifactId: "package.json"
        }
      )
    ).toThrow("outside the packet");
  });

  it("bounds reviewer output before parsing", () => {
    expect(() =>
      validateReviewerReport(report + "x".repeat(8_000), {
        surface: "public-surface",
        artifactId: "package.json"
      })
    ).toThrow("bounded output limit");
  });

  it("closes a completed reviewer exactly once", async () => {
    const watchdog = createReviewerWatchdog({
      agentId: "agent-1",
      surface: "public-surface",
      artifactId: "package.json",
      closeAgent: hostClose("completed", true)
    });
    expect(watchdog.accept(report)).toEqual({ status: "complete", replacementAllowed: false });
    await expect(watchdog.close()).resolves.toEqual({
      status: "closed",
      dispatchAllowed: true,
      closeEvidence: {
        source: "host-close-agent",
        agentId: "agent-1",
        previousStatus: "completed",
        closed: true
      }
    });
    expect(watchdog.closeCalls).toBe(1);
    expect(watchdog.assertDispatchAllowed()).toEqual({
      agentId: "agent-1",
      surface: "public-surface"
    });
    await expect(watchdog.close()).rejects.toThrow("exactly once");
  });

  it("makes malformed reports terminal and closeable", async () => {
    const watchdog = createReviewerWatchdog({
      agentId: "agent-malformed",
      surface: "public-surface",
      artifactId: "package.json",
      closeAgent: hostClose("running", true)
    });
    expect(() => watchdog.accept("malformed")).toThrow("header is invalid");
    expect(watchdog.snapshot()).toMatchObject({
      state: "tool-failure",
      replacementAllowed: false,
      dispatchAllowed: false
    });
    await expect(watchdog.close()).resolves.toMatchObject({
      status: "closed",
      dispatchAllowed: false
    });
    expect(() => watchdog.accept(report)).toThrow("terminal");
  });

  it("makes timeout terminal and forbids replacement", async () => {
    const watchdog = createReviewerWatchdog({
      agentId: "agent-2",
      surface: "public-surface",
      artifactId: "package.json",
      waitBudgetSeconds: 60,
      closeAgent: hostClose("running", true)
    });
    expect(watchdog.timeout()).toEqual({
      status: "timeout",
      outcome: "defer-external",
      replacementAllowed: false
    });
    await expect(watchdog.close()).resolves.toEqual({
      status: "closed",
      dispatchAllowed: false,
      closeEvidence: {
        source: "host-close-agent",
        agentId: "agent-2",
        previousStatus: "running",
        closed: true
      }
    });
    expect(() => watchdog.assertDispatchAllowed()).toThrow("dispatch is forbidden");
    expect(() => watchdog.accept(report)).toThrow("terminal");
  });

  it("stops dispatch when close cannot be confirmed", async () => {
    const watchdog = createReviewerWatchdog({
      agentId: "agent-3",
      surface: "public-surface",
      artifactId: "package.json",
      closeAgent: hostClose("not_found", false)
    });
    watchdog.toolFailure();
    await expect(watchdog.close()).resolves.toEqual({
      status: "close-unconfirmed",
      dispatchAllowed: false,
      closeEvidence: {
        source: "host-close-agent",
        agentId: "agent-3",
        previousStatus: "not_found",
        closed: false
      }
    });
    expect(watchdog.snapshot()).toMatchObject({ closeCalls: 1, closeConfirmed: false });
  });

  it("rejects forged close proof values", async () => {
    const watchdog = createReviewerWatchdog({
      agentId: "agent-4",
      surface: "public-surface",
      artifactId: "package.json",
      closeAgent: () => ({
        source: "host-close-agent",
        agentId: "agent-other",
        previousStatus: "running",
        closed: true
      })
    });
    watchdog.timeout();
    await expect(watchdog.close()).rejects.toThrow("agent id");

    const unknownStatus = createReviewerWatchdog({
      agentId: "agent-5",
      surface: "public-surface",
      artifactId: "package.json",
      closeAgent: hostClose("invented", true)
    });
    unknownStatus.timeout();
    await expect(unknownStatus.close()).rejects.toThrow("known host status");
  });
});
