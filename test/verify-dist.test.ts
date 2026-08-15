import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { lstatSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import {
  collectFiles,
  MAX_GENERATED_FILE_BYTES,
  MAX_GENERATED_DIRECTORIES,
  MAX_SOURCE_MAP_DEPTH,
  MAX_SOURCE_MAP_BYTES,
  MAX_SOURCE_MAP_RANGES,
  normalizeSourceMapBytes,
  readStableFile
} from "../scripts/verify-dist.mjs";

describe("generated dist verification", () => {
  it("normalizes nested source maps without rewriting unrelated fields", () => {
    const sourceMap = {
      version: 3,
      note: "../src/must-not-change.ts",
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: {
            version: 3,
            sources: ["../src/nested.ts"],
            note: "../src/nested-note.ts"
          }
        }
      ]
    };

    const normalized = JSON.parse(
      normalizeSourceMapBytes(
        Buffer.from(JSON.stringify(sourceMap), "utf8"),
        process.cwd()
      ).toString("utf8")
    ) as typeof sourceMap;

    expect(normalized.note).toBe("../src/must-not-change.ts");
    expect(normalized.sections[0]?.map.sources).toEqual(["src/nested.ts"]);
    expect(normalized.sections[0]?.map.note).toBe("../src/nested-note.ts");
  });

  it("preserves every non-source-map byte while replacing only source tokens", () => {
    const sourceMap =
      '{"version":3, "sections":[{"offset":{"line":0,"column":0},"map":{"version":3, "sources":["../src/nested.ts"],"note":"../src/nested-note.ts"}}], "note":"../src/keep.ts", "number":1e+0}';
    const expected =
      '{"version":3, "sections":[{"offset":{"line":0,"column":0},"map":{"version":3, "sources":["src/nested.ts"],"note":"../src/nested-note.ts"}}], "note":"../src/keep.ts", "number":1e+0}';

    expect(
      normalizeSourceMapBytes(Buffer.from(sourceMap, "utf8"), process.cwd()).toString("utf8")
    ).toBe(expected);
  });

  it("leaves invalid source arrays and metadata sources untouched", () => {
    const sourceMap =
      '{"version":3,"sources":[{"sources":["../src/invalid.ts"]}],"metadata":{"sources":["../src/meta.ts"]}}';

    expect(
      normalizeSourceMapBytes(Buffer.from(sourceMap, "utf8"), process.cwd()).toString("utf8")
    ).toBe(sourceMap);
  });

  it("rejects source-map normalization before parsing oversized input", () => {
    const oversized = Buffer.alloc(MAX_SOURCE_MAP_BYTES + 1, 0x20);

    expect(normalizeSourceMapBytes(oversized, process.cwd())).toBe(oversized);
  });

  it("preserves invalid UTF-8 and prevents source-map digest collisions", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewready-dist-test-"));
    const validRoot = await mkdtemp(join(tmpdir(), "reviewready-dist-valid-"));
    const validText = '{"version":3,"sources":["../src/a.ts"],"note":"�"}';
    const validBytes = Buffer.from(validText, "utf8");
    const invalidBytes = Buffer.from(validBytes.toString("hex").replace("efbfbd", "ff"), "hex");
    try {
      await writeFile(join(root, "output.map"), invalidBytes);
      await writeFile(join(validRoot, "output.map"), validBytes);

      expect(normalizeSourceMapBytes(invalidBytes, process.cwd())).toBe(invalidBytes);
      expect(collectFiles(root, "", root).get("output.map")).not.toBe(
        collectFiles(validRoot, "", validRoot).get("output.map")
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(validRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects non-UTF-8 generated directory entries",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "reviewready-dist-invalid-name-test-"));
      const invalidName = Buffer.concat([
        Buffer.from(root),
        Buffer.from("/"),
        Buffer.from([0xff, 0x2e, 0x6a, 0x73])
      ]);
      try {
        await writeFile(join(root, "�.js"), "valid");
        await writeFile(invalidName, "invalid");

        expect(() => collectFiles(root, "", root)).toThrow("non-UTF-8");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it("leaves malformed source-map and indexed-section structures untouched", () => {
    const malformed = [
      '{"version":"3","sources":["../src/a.ts"]}',
      '{"version":3,"sources":["../src/a.ts"],"sections":[]}',
      '{"version":3,"sections":[{"offset":{"line":"0","column":0},"map":{"version":3,"sources":["../src/a.ts"]}}]}',
      '{"version":3,"sections":[{"offset":{"line":0,"column":0},"map":{"version":3,"sources":[{"bad":true}]}}]}'
    ];

    for (const sourceMap of malformed) {
      const bytes = Buffer.from(sourceMap, "utf8");
      expect(normalizeSourceMapBytes(bytes, process.cwd()).toString("utf8")).toBe(sourceMap);
    }
  });

  it("rejects over-depth source maps before parsing the complete input", () => {
    const nested =
      "[".repeat(MAX_SOURCE_MAP_DEPTH + 2) +
      JSON.stringify("x".repeat(2_000)) +
      "]".repeat(MAX_SOURCE_MAP_DEPTH + 2);
    const sourceMap = '{"version":3,"sections":' + nested + "}";
    const parseSpy = vi.spyOn(JSON, "parse");

    try {
      expect(
        normalizeSourceMapBytes(Buffer.from(sourceMap, "utf8"), process.cwd()).toString("utf8")
      ).toBe(sourceMap);
      expect(
        parseSpy.mock.calls.some(([value]) => typeof value === "string" && value.length > 1_000)
      ).toBe(false);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it("bounds source-token rewriting before building an unbounded range list", () => {
    const bytes = Buffer.from(
      JSON.stringify({
        version: 3,
        sources: Array.from({ length: MAX_SOURCE_MAP_RANGES + 1 }, () => "../src/a.ts")
      }),
      "utf8"
    );

    expect(normalizeSourceMapBytes(bytes, process.cwd())).toBe(bytes);
  });

  it("normalizes at the source-token boundary within bounded work", () => {
    const bytes = Buffer.from(
      JSON.stringify({
        version: 3,
        sources: Array.from(
          { length: MAX_SOURCE_MAP_RANGES },
          (_, index) => "../src/" + String(index) + ".ts"
        )
      }),
      "utf8"
    );

    const normalized = normalizeSourceMapBytes(bytes, process.cwd()).toString("utf8");
    expect(normalized).toContain('"src/0.ts"');
    expect(normalized).toContain('"src/65535.ts"');
  }, 15_000);

  it("does not canonicalize source paths through a traversal segment", () => {
    const sourceMap = '{"version":3,"sources":["../src/../outside.ts"],"names":[],"mappings":""}';
    const bytes = Buffer.from(sourceMap, "utf8");

    expect(normalizeSourceMapBytes(bytes, process.cwd())).toEqual(bytes);
  });

  it("leaves duplicate source-map keys byte-identical", () => {
    const sourceMap = '{"version":3,"sources":["../src/a.ts"],"sources":["../src/b.ts"]}';
    const bytes = Buffer.from(sourceMap, "utf8");

    expect(normalizeSourceMapBytes(bytes, process.cwd())).toEqual(bytes);
  });

  it("preserves a UTF-8 BOM and prevents BOM digest collisions", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewready-dist-test-"));
    const cleanRoot = await mkdtemp(join(tmpdir(), "reviewready-dist-clean-"));
    const sourceMap = '{"version":3,"sources":["../src/a.ts"],"mappings":"","names":[]}';
    const cleanBytes = Buffer.from(sourceMap, "utf8");
    const bomBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), cleanBytes]);
    try {
      await writeFile(join(root, "output.map"), bomBytes);
      await writeFile(join(cleanRoot, "output.map"), cleanBytes);

      expect(normalizeSourceMapBytes(bomBytes, process.cwd()).subarray(0, 3)).toEqual(
        Buffer.from([0xef, 0xbb, 0xbf])
      );
      expect(collectFiles(root, "", root).get("output.map")).not.toBe(
        collectFiles(cleanRoot, "", cleanRoot).get("output.map")
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(cleanRoot, { recursive: true, force: true });
    }
  });

  it("rejects an opened file over the per-file bound before allocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewready-dist-test-"));
    const file = join(root, "large-output.js");
    try {
      await writeFile(file, "x");
      await truncate(file, MAX_GENERATED_FILE_BYTES + 1);
      expect(() => readStableFile(file, lstatSync(file))).toThrow("too large");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects content replacement that preserves file size and mtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewready-dist-stability-test-"));
    const file = join(root, "output.js");
    try {
      const fixedTime = new Date("2020-01-01T00:00:00.000Z");
      writeFileSync(file, "safe!");
      utimesSync(file, fixedTime, fixedTime);

      expect(() =>
        collectFiles(root, "", root, {
          afterDirectoryRead: (directory: string) => {
            writeFileSync(join(directory, "output.js"), "evil!");
            utimesSync(file, fixedTime, fixedTime);
          }
        })
      ).toThrow("changed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects directory additions observed after traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewready-dist-test-"));
    try {
      await writeFile(join(root, "initial.js"), "initial");
      expect(() =>
        collectFiles(root, "", root, {
          afterDirectoryRead: (directory: string) => {
            writeFileSync(join(directory, "late.js"), "late");
          }
        })
      ).toThrow("directory changed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects same-name file replacement after digesting", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewready-dist-file-race-test-"));
    try {
      await writeFile(join(root, "initial.js"), "safe");
      expect(() =>
        collectFiles(root, "", root, {
          afterDirectoryRead: (directory: string) => {
            writeFileSync(join(directory, "initial.js"), "evil");
          }
        })
      ).toThrow("file changed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("revalidates files from nested directories after parent traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewready-dist-nested-race-test-"));
    const nested = join(root, "sub");
    try {
      await mkdir(nested);
      await writeFile(join(nested, "output.js"), "safe");
      expect(() =>
        collectFiles(root, "", root, {
          afterDirectoryRead: (directory: string) => {
            if (directory === root) {
              writeFileSync(join(nested, "output.js"), "evil");
            }
          }
        })
      ).toThrow("file changed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects additions inside an already-traversed descendant directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewready-dist-nested-addition-test-"));
    const nested = join(root, "sub");
    try {
      await mkdir(nested);
      await writeFile(join(nested, "output.js"), "safe");
      expect(() =>
        collectFiles(root, "", root, {
          afterDirectoryRead: (directory: string) => {
            if (directory === root) {
              const lateDirectory = join(nested, "late");
              mkdirSync(lateDirectory);
              writeFileSync(join(lateDirectory, "output.js"), "late");
            }
          }
        })
      ).toThrow("directory changed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("bounds generated output tree depth before reading untrusted build output", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewready-dist-test-"));
    try {
      let current = root;
      for (let index = 0; index < 40; index += 1) {
        current = join(current, "d" + String(index));
        await mkdir(current);
      }
      await writeFile(join(current, "output.js"), "safe");

      expect(() => collectFiles(root, "", root)).toThrow("generated output depth");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("bounds directory traversal before accepting unbounded empty directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewready-dist-test-"));
    try {
      for (let index = 0; index <= MAX_GENERATED_DIRECTORIES; index += 1) {
        await mkdir(join(root, "empty-" + String(index)));
      }

      expect(() => collectFiles(root, "", root)).toThrow("generated output directory count");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a non-directory collection root before opening it", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewready-dist-test-"));
    const file = join(root, "not-a-directory");
    try {
      await writeFile(file, "not a directory");
      expect(() => collectFiles(file, "", root)).toThrow("regular directory");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("rejects symlink roots and symlink entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "reviewready-dist-test-"));
    const target = await mkdtemp(join(tmpdir(), "reviewready-dist-target-"));
    try {
      await writeFile(join(target, "output.js"), "safe");
      const rootLink = join(root, "root-link");
      await symlink(target, rootLink, "dir");
      expect(() => collectFiles(rootLink, "", root)).toThrow("symlink");

      const entryLink = join(root, "entry-link");
      await symlink(join(target, "output.js"), entryLink, "file");
      expect(() => collectFiles(root, "", root)).toThrow("symlink");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  });
});
