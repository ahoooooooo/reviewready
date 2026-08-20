import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseHandoffDocument,
  validateHandoffDocument,
  worktreeDigest
} from "../scripts/agent-handoff.mjs";

describe("canonical agent handoff", () => {
  it("loads the Draft 2020-12 schema runtime and parses the JSON payload", () => {
    const document = [
      "<!-- REVIEWREADY_HANDOFF_JSON_BEGIN -->",
      "```json",
      JSON.stringify({
        document_type: "REVIEWREADY_CANONICAL_AGENT_HANDOFF",
        schema_version: 1,
        project: "ReviewReady"
      }),
      "```",
      "<!-- REVIEWREADY_HANDOFF_JSON_END -->",
      "# CANONICAL AGENT HANDOFF",
      ""
    ].join("\n");

    expect(parseHandoffDocument(document).value).toMatchObject({
      document_type: "REVIEWREADY_CANONICAL_AGENT_HANDOFF",
      schema_version: 1,
      project: "ReviewReady"
    });
  });

  it("validates the checked-in handoff and binds it to the current worktree", () => {
    const source = readFileSync("HANDOFF.md", "utf8");

    const validated = validateHandoffDocument(source, {
      workspace: true,
      filePath: "HANDOFF.md"
    });
    expect(validated).toMatchObject({
      document_type: "REVIEWREADY_CANONICAL_AGENT_HANDOFF"
    });
    expect(["defer-external", "reopen"]).toContain(validated.outcome);
  });

  it("rejects an edited handoff until it is refreshed", () => {
    const source = readFileSync("HANDOFF.md", "utf8");
    const phaseMatch = source.match(/"phase":\s*"([^"]+)"/u);
    expect(phaseMatch?.[1]).toBeDefined();
    const replacementPhase = phaseMatch?.[1] === "repair" ? "proof" : "repair";
    const edited = source.replace(phaseMatch?.[0] ?? "", '"phase": "' + replacementPhase + '"');

    expect(() => validateHandoffDocument(edited, { workspace: false })).toThrow(
      "content changed without running handoff:refresh"
    );
  });

  it("rejects passed validation evidence from an older worktree digest", () => {
    const source = readFileSync("HANDOFF.md", "utf8");
    const stale = structuredClone(parseHandoffDocument(source).value) as Record<string, unknown> & {
      validation: { status: string; change_digest: string }[];
    };
    const candidate = stale.validation[0];
    expect(candidate).toBeDefined();
    if (candidate === undefined) return;
    candidate.status = "passed";
    const passed = stale.validation.find((entry) => entry.status === "passed");
    expect(passed).toBeDefined();
    if (passed === undefined) return;
    passed.change_digest = "sha256:" + "0".repeat(64);

    expect(() => validateHandoffDocument(stale, { workspace: false })).toThrow(
      "passed validation evidence for an older worktree"
    );
  });

  it("does not treat staging the same file as a content change", () => {
    const unstagedDigest = worktreeDigest([{ status: " M", path: "package.json" }], "HANDOFF.md");
    const stagedDigest = worktreeDigest([{ status: "M ", path: "package.json" }], "HANDOFF.md");

    expect(stagedDigest).toBe(unstagedDigest);
  });
});
