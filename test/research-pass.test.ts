import { describe, expect, it } from "vitest";

import { createResearchPassWatchdog, validateResearchPass } from "../scripts/research-pass.mjs";

const pass = [
  "RESEARCH_PASS_V1",
  "surface=authority",
  "sources=raw:source-1",
  "claim_ids=claim-1",
  "evidence=raw:source-1:lines=1-2",
  "counter_case=none",
  "freshness=2026-08-19; refresh on release change",
  "outcome=continue"
].join("\n");

function hostClose(previousStatus: string, closed: boolean) {
  return (agentId: string) => ({
    source: "host-close-agent",
    agentId,
    previousStatus,
    closed
  });
}

describe("research pass validator", () => {
  it("accepts a bounded raw source handoff", () => {
    expect(
      validateResearchPass(pass, { surface: "authority", artifactId: "raw:source-1" })
    ).toMatchObject({
      surface: "authority",
      claim_ids: "claim-1",
      outcome: "continue"
    });
  });

  it("rejects off-scope or similarly named evidence", () => {
    expect(() =>
      validateResearchPass(pass.replace("surface=authority", "surface=adoption"), {
        surface: "authority",
        artifactId: "raw:source-1"
      })
    ).toThrow("off-scope");
    expect(() =>
      validateResearchPass(pass.replace("raw:source-1:lines", "raw:other-source:lines"), {
        surface: "authority",
        artifactId: "raw:source-1"
      })
    ).toThrow("outside the raw packet");
    expect(() =>
      validateResearchPass(pass, { surface: "authority", artifactId: "derived:claim-map" })
    ).toThrow("raw: prefix");
  });

  it("bounds source-pass output before parsing", () => {
    expect(() =>
      validateResearchPass(pass + "x".repeat(8_000), {
        surface: "authority",
        artifactId: "raw:source-1"
      })
    ).toThrow("bounded output limit");
  });

  it("requires complete claim, freshness, counter-case, and outcome fields", () => {
    expect(() =>
      validateResearchPass(pass.replace("freshness=2026-08-19; refresh on release change\n", ""), {
        surface: "authority",
        artifactId: "raw:source-1"
      })
    ).toThrow("freshness");
    expect(() =>
      validateResearchPass(pass.replace("outcome=continue", "outcome=promote"), {
        surface: "authority",
        artifactId: "raw:source-1"
      })
    ).toThrow("outcome");
  });

  it("uses a closeable terminal lifecycle for source passes", async () => {
    const watchdog = createResearchPassWatchdog({
      agentId: "research-agent-1",
      surface: "authority",
      artifactId: "raw:source-1",
      closeAgent: hostClose("completed", true)
    });
    expect(watchdog.accept(pass)).toMatchObject({ status: "complete" });
    await expect(watchdog.close()).resolves.toMatchObject({
      status: "closed",
      dispatchAllowed: true
    });

    const malformed = createResearchPassWatchdog({
      agentId: "research-agent-2",
      surface: "authority",
      artifactId: "raw:source-1",
      closeAgent: hostClose("running", true)
    });
    expect(() => malformed.accept("malformed")).toThrow("header is invalid");
    expect(malformed.snapshot()).toMatchObject({ state: "tool-failure" });
    await expect(malformed.close()).resolves.toMatchObject({
      status: "closed",
      dispatchAllowed: false
    });
  });
});
