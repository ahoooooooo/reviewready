import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LOCAL_NPM_CACHE_DIRECTORY, localNpmEnvironment } from "../scripts/npm-runtime.mjs";

describe("child npm runtime", () => {
  it("uses a workspace-local cache when the caller has no explicit cache", () => {
    const environment = localNpmEnvironment("D:/workspace", {
      NPM_CONFIG_CACHE: "C:/wrong-cache",
      PATH: "test",
      npm_config_cache: "C:/also-wrong-cache"
    });

    expect(environment.npm_config_cache).toBe(join("D:/workspace", LOCAL_NPM_CACHE_DIRECTORY));
    expect(environment.NPM_CONFIG_CACHE).toBe(environment.npm_config_cache);
    expect(environment.PATH).toBe("test");
  });

  it("preserves an explicitly selected process-local cache", () => {
    const environment = localNpmEnvironment("D:/workspace", {
      REVIEWREADY_NPM_CACHE: "D:/approved-cache"
    });

    expect(environment.npm_config_cache).toBe("D:/approved-cache");
  });

  it("removes inherited npm config and Node execution overrides", () => {
    const environment = localNpmEnvironment("D:/workspace", {
      NODE_OPTIONS: "--require D:/untrusted.js",
      NODE_PATH: "D:/untrusted-modules",
      npm_config_prefix: "D:/untrusted-prefix",
      npm_config_registry: "https://registry.example.invalid",
      NPM_CONFIG_USERCONFIG: "D:/untrusted.npmrc"
    });

    expect(environment.NODE_OPTIONS).toBeUndefined();
    expect(environment.NODE_PATH).toBeUndefined();
    expect(environment.npm_config_prefix).toBeUndefined();
    expect(environment.npm_config_registry).toBeUndefined();
    expect(environment.NPM_CONFIG_USERCONFIG).toBeUndefined();
  });
});
