import { generateKeyPairSync, verify } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createGitHubAppJwt,
  createInstallationAccessToken,
  type GitHubAppRequest
} from "../src/github-app.js";

const nowMs = Date.parse("2026-08-12T00:00:00.000Z");

function privateKey(): string {
  return generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
    format: "pem",
    type: "pkcs8"
  });
}

function credentials(
  overrides: Partial<{ appId: number; privateKey: string; nowMs: number }> = {}
) {
  return {
    appId: 123,
    privateKey: privateKey(),
    nowMs,
    ...overrides
  };
}

function responseRequest(data: unknown): GitHubAppRequest {
  return {
    request: vi.fn<GitHubAppRequest["request"]>(() => Promise.resolve({ data }))
  };
}

function decode(value: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("GitHub App authentication", () => {
  it("creates a short-lived RS256 JWT with bounded clock skew", () => {
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKey = keys.privateKey.export({ format: "pem", type: "pkcs8" });
    const publicKey = keys.publicKey.export({ format: "pem", type: "spki" });
    const token = createGitHubAppJwt({ appId: 123, privateKey, nowMs });
    const parts = token.split(".");
    const headerPart = parts[0];
    const payloadPart = parts[1];
    const signaturePart = parts[2];
    if (headerPart === undefined || payloadPart === undefined || signaturePart === undefined) {
      throw new Error("JWT fixture is malformed");
    }
    const header = decode(headerPart);
    const payload = decode(payloadPart);

    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(payload).toMatchObject({
      iss: "123",
      iat: Math.floor(nowMs / 1_000) - 60,
      exp: Math.floor(nowMs / 1_000) + 480
    });
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${headerPart}.${payloadPart}`),
        publicKey,
        Buffer.from(signaturePart, "base64url")
      )
    ).toBe(true);
  });

  it("requests and validates an installation token without logging credentials", async () => {
    const requestFn = vi.fn<GitHubAppRequest["request"]>(() =>
      Promise.resolve({
        data: {
          token: "ghs_installation-token",
          expires_at: new Date(nowMs + 60 * 60 * 1_000).toISOString(),
          permissions: { metadata: "read", contents: "read" },
          repositories: [{ id: 99, full_name: "octocat/demo" }]
        }
      })
    );
    const request: GitHubAppRequest = { request: requestFn };
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKey = keys.privateKey.export({ format: "pem", type: "pkcs8" });

    await expect(
      createInstallationAccessToken(request, { appId: 123, privateKey, nowMs }, 17)
    ).resolves.toMatchObject({
      token: "ghs_installation-token",
      expiresAt: new Date(nowMs + 60 * 60 * 1_000).toISOString(),
      permissions: { metadata: "read", contents: "read" },
      repositoryIds: [99]
    });
    expect(requestFn).toHaveBeenCalledTimes(1);
    const call = requestFn.mock.calls[0];
    if (call === undefined) {
      throw new Error("GitHub App request was not captured");
    }
    const [route, parameters] = call;
    expect(route).toBe("POST /app/installations/{installation_id}/access_tokens");
    expect(parameters.installation_id).toBe(17);
    const headers = parameters.headers;
    if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
      throw new Error("GitHub App request headers are malformed");
    }
    const authorization = (headers as Record<string, unknown>).Authorization;
    if (typeof authorization !== "string") {
      throw new Error("GitHub App authorization header is missing");
    }
    expect(authorization).toMatch(/^Bearer /u);
  });

  it("fails closed for invalid credentials, clock, installation, and transport input", async () => {
    expect(() => createGitHubAppJwt({ appId: 0, privateKey: "not-a-key", nowMs })).toThrow(
      "GitHub App credentials are invalid"
    );
    expect(() => createGitHubAppJwt({ appId: 123, privateKey: "", nowMs })).toThrow(
      "GitHub App credentials are invalid"
    );
    expect(() => createGitHubAppJwt(credentials({ nowMs: -1 }))).toThrow(
      "GitHub App clock input is invalid"
    );
    await expect(
      createInstallationAccessToken(responseRequest({}), credentials(), 0)
    ).rejects.toMatchObject({ code: "GITHUB_APP_AUTH_INVALID" });

    const failing: GitHubAppRequest = {
      request: vi.fn<GitHubAppRequest["request"]>(() =>
        Promise.reject(new Error("network failure"))
      )
    };
    await expect(createInstallationAccessToken(failing, credentials(), 17)).rejects.toMatchObject({
      code: "GITHUB_APP_AUTH_FAILED"
    });
  });

  it.each([
    ["expired", new Date(nowMs).toISOString()],
    ["too far in the future", new Date(nowMs + 3 * 60 * 60 * 1_000).toISOString()],
    ["malformed", "not-a-date"]
  ])("rejects an installation token with %s expiry", async (_label, expiresAt) => {
    await expect(
      createInstallationAccessToken(
        responseRequest({ token: "ghs_token", expires_at: expiresAt, permissions: {} }),
        credentials(),
        17
      )
    ).rejects.toMatchObject({ code: "GITHUB_APP_AUTH_INVALID" });
  });

  it.each([
    ["missing response object", null],
    ["empty token", { token: "", expires_at: new Date(nowMs + 60_000).toISOString() }],
    [
      "invalid permission name",
      {
        token: "ghs_token",
        expires_at: new Date(nowMs + 60_000).toISOString(),
        permissions: { "": "read" }
      }
    ],
    [
      "invalid permission value",
      {
        token: "ghs_token",
        expires_at: new Date(nowMs + 60_000).toISOString(),
        permissions: { contents: "" }
      }
    ],
    [
      "invalid repositories",
      {
        token: "ghs_token",
        expires_at: new Date(nowMs + 60_000).toISOString(),
        permissions: {},
        repositories: [{}]
      }
    ],
    [
      "non-array repositories",
      {
        token: "ghs_token",
        expires_at: new Date(nowMs + 60_000).toISOString(),
        permissions: {},
        repositories: {}
      }
    ]
  ])("rejects %s in an installation response", async (_label, data) => {
    await expect(
      createInstallationAccessToken(responseRequest(data), credentials(), 17)
    ).rejects.toMatchObject({ code: "GITHUB_APP_AUTH_INVALID" });
  });

  it("rejects an oversized installation response before parsing fields", async () => {
    await expect(
      createInstallationAccessToken(
        responseRequest({ token: "ghs_token", expires_at: "x", padding: "a".repeat(512 * 1024) }),
        credentials(),
        17
      )
    ).rejects.toMatchObject({ code: "GITHUB_APP_AUTH_INVALID" });
  });

  it("fails closed for invalid installation responses and private-key input", async () => {
    const requestFn = vi.fn<GitHubAppRequest["request"]>(() =>
      Promise.resolve({ data: { token: "", expires_at: "never" } })
    );
    const request: GitHubAppRequest = { request: requestFn };
    await expect(
      createInstallationAccessToken(request, { appId: 123, privateKey: "not-a-key", nowMs }, 17)
    ).rejects.toMatchObject({ code: "GITHUB_APP_AUTH_INVALID" });
  });

  it("bounds the number of permission keys in an installation response", async () => {
    const permissions = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`permission-${String(index)}`, "read"])
    );
    const requestFn = vi.fn<GitHubAppRequest["request"]>(() =>
      Promise.resolve({
        data: {
          token: "ghs_installation-token",
          expires_at: new Date(nowMs + 60 * 60 * 1_000).toISOString(),
          permissions
        }
      })
    );
    const request: GitHubAppRequest = { request: requestFn };
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKey = keys.privateKey.export({ format: "pem", type: "pkcs8" });

    await expect(
      createInstallationAccessToken(request, { appId: 123, privateKey, nowMs }, 17)
    ).rejects.toMatchObject({ code: "GITHUB_APP_AUTH_INVALID" });
  });
});
