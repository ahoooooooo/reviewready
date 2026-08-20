import { describe, expect, it } from "vitest";

import {
  normalizeDoctorEnvironment,
  REQUIRED_DOCTOR_CHECKS,
  validateDoctorAdmission
} from "../scripts/reviewer-admission.mjs";
import {
  CHILD_CANARY_SENTINEL,
  runChildCanary,
  runStreamingChildCanary
} from "../scripts/windows-child-canary.mjs";

function doctorOutput(warnings: string[] = []) {
  const checks = Object.fromEntries(REQUIRED_DOCTOR_CHECKS.map((id) => [id, { status: "ok" }]));
  for (const id of warnings) checks[id] = { status: "warning" };
  return { overallStatus: warnings.length > 0 ? "warning" : "ok", checks };
}

describe("reviewer admission", () => {
  it("normalizes dumb TERM without mutating the caller environment", () => {
    const input = { TERM: "dumb", PATH: "preserved" };
    expect(normalizeDoctorEnvironment(input)).toMatchObject({
      TERM: "xterm-256color",
      PATH: "preserved"
    });
    expect(input.TERM).toBe("dumb");
  });

  it("accepts only non-functional doctor warnings", () => {
    expect(validateDoctorAdmission(doctorOutput(["git.worktree.dev_drive"]))).toEqual({
      admitted: true,
      overallStatus: "warning",
      warnings: ["git.worktree.dev_drive"]
    });
    expect(() => validateDoctorAdmission(doctorOutput(["unknown.advisory"]))).toThrow(
      "non-advisory warnings"
    );
  });

  it("rejects missing or failed required checks", () => {
    const missing = doctorOutput();
    delete (missing.checks as Record<string, unknown>)["state.paths"];
    expect(() => validateDoctorAdmission(missing)).toThrow("state.paths");
    expect(() => validateDoctorAdmission({ ...doctorOutput(), overallStatus: "fail" })).toThrow(
      "overallStatus"
    );
  });

  it("runs the real bounded child canary without shell indirection", () => {
    expect(CHILD_CANARY_SENTINEL).toBe("codex-spawn-ok");
    expect(runChildCanary()).toMatchObject({ status: "passed", stdout: CHILD_CANARY_SENTINEL });
  });

  it("drains a large child stream before waiting for close", async () => {
    await expect(runStreamingChildCanary()).resolves.toMatchObject({ status: "passed" });
  });

  it("confirms child close after timeout cleanup", async () => {
    await expect(runStreamingChildCanary(process.execPath, 1)).resolves.toMatchObject({
      status: "failed",
      code: "child-timeout",
      closeConfirmed: true
    });
  });
});
