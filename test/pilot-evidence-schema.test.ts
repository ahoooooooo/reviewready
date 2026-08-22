import { readFile } from "node:fs/promises";

import Ajv2020Module from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { semanticPilotEvidenceErrors } from "../scripts/validate-pilot-evidence.mjs";

type Draft2020Constructor = new (options?: {
  readonly allErrors?: boolean;
  readonly strict?: boolean;
}) => {
  compile: (schema: object) => {
    (data: unknown): boolean;
    readonly errors?: readonly unknown[] | null;
  };
};

const Ajv2020 = Ajv2020Module as unknown as Draft2020Constructor;

async function documents(): Promise<{
  readonly example: Record<string, unknown>;
  readonly validate: (data: unknown) => boolean;
}> {
  const [schema, example] = await Promise.all([
    readFile("docs/pilot/evidence.schema.json", "utf8"),
    readFile("fixtures/pilot/pilot-evidence-example-v1.json", "utf8")
  ]);
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
    JSON.parse(schema) as object
  );
  return { example: JSON.parse(example) as Record<string, unknown>, validate };
}

function observedSelfDogfood(example: Record<string, unknown>): Record<string, unknown> {
  return {
    ...structuredClone(example),
    recordStatus: "observed",
    subject: {
      repository: "ahoooooooo/reviewready",
      visibility: "public",
      baseSha: "a".repeat(40),
      policyPath: ".reviewready.yml"
    },
    run: {
      toolReference: "e9cd421ac106adb5731dd22b714701a136e937f8",
      immutableReference: true,
      startedAt: "2026-08-20T00:00:00.000Z",
      endedAt: "2026-08-21T00:00:00.000Z",
      sampleSelection: "all-consecutive",
      setupMethod: "stable-release",
      setupMinutes: 3
    },
    outcomes: {
      evaluatedPullRequests: 2,
      readyReports: 1,
      notReadyReports: 1,
      confirmedFalsePositives: 0,
      confirmedFalseNegatives: 0,
      maintainerVerdict: "keep",
      friction: [],
      notes: []
    }
  };
}

describe("pilot evidence schema", () => {
  it("accepts the clearly labeled example and a bounded observed self-dogfood record", async () => {
    const { example, validate } = await documents();
    expect(validate(example)).toBe(true);

    const observed = observedSelfDogfood(example);
    expect(validate(observed)).toBe(true);
    expect(semanticPilotEvidenceErrors(observed)).toEqual([]);
  });

  it("requires explicit consent, a link, and bounded claims for observed external pilots", async () => {
    const { example, validate } = await documents();
    const external = {
      ...observedSelfDogfood(example),
      classification: "external-pilot",
      consent: {
        status: "confirmed",
        publicationScope: "private",
        recordedAt: "2026-08-19T00:00:00.000Z",
        revocationRoute: "Private participant-owned consent record"
      },
      evidenceLinks: ["https://github.com/example/project/actions/runs/1"],
      claims: {
        externalPilotObserved: true,
        broadAdoption: false,
        productionAuthority: false
      }
    };
    expect(validate(external)).toBe(true);

    expect(validate({ ...external, consent: example.consent as object })).toBe(false);
    expect(validate({ ...external, evidenceLinks: [] })).toBe(false);
    expect(
      validate({
        ...external,
        claims: { ...(external.claims as object), broadAdoption: true }
      })
    ).toBe(false);
  });

  it("rejects secret flags, unknown fields, inconsistent totals, and reversed dates", async () => {
    const { example, validate } = await documents();
    const observed = observedSelfDogfood(example);

    expect(
      validate({
        ...observed,
        dataHandling: { ...(observed.dataHandling as object), secretsIncluded: true }
      })
    ).toBe(false);
    expect(validate({ ...observed, testimonial: "not consented" })).toBe(false);
    expect(
      semanticPilotEvidenceErrors({
        ...observed,
        outcomes: { ...(observed.outcomes as object), readyReports: 2 }
      })
    ).toContain("outcome-total-invalid");
    expect(
      semanticPilotEvidenceErrors({
        ...observed,
        run: {
          ...(observed.run as object),
          startedAt: "2026-08-22T00:00:00.000Z",
          endedAt: "2026-08-21T00:00:00.000Z"
        }
      })
    ).toContain("observation-window-invalid");
    expect(
      semanticPilotEvidenceErrors({
        ...observed,
        run: {
          ...(observed.run as object),
          startedAt: "2026-02-30T00:00:00.000Z"
        }
      })
    ).toContain("observation-window-invalid");
  });
});
