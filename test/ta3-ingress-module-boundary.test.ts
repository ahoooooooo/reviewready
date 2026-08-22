import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import * as contracts from "../src/ta3-ingress-contracts.js";
import * as ingress from "../src/ta3-ingress.js";

async function lineCount(path: string): Promise<number> {
  return (await readFile(path, "utf8")).split("\n").length;
}

describe("trusted ingress module boundary", () => {
  it("keeps public contracts independent from the reference state store", async () => {
    const [implementation, contractSource] = await Promise.all([
      readFile("src/ta3-ingress.ts", "utf8"),
      readFile("src/ta3-ingress-contracts.ts", "utf8")
    ]);

    expect(await lineCount("src/ta3-ingress.ts")).toBeLessThan(1_000);
    expect(await lineCount("src/ta3-ingress-contracts.ts")).toBeLessThan(200);
    expect(implementation).toContain('export * from "./ta3-ingress-contracts.js"');
    expect(contractSource).not.toContain("class InMemoryTrustedIngressStore");
    expect(contractSource).not.toContain("node:crypto");
    expect(ingress.TA3_MAX_ATTEMPTS).toBe(contracts.TA3_MAX_ATTEMPTS);
    expect(ingress.TA3_MAX_BODY_BYTES).toBe(contracts.TA3_MAX_BODY_BYTES);
  });
});
