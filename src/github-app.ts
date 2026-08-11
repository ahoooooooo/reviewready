import { createSign } from "node:crypto";

import { PlatformError } from "./errors.js";

const API_VERSION = "2026-03-10";
const MAX_PRIVATE_KEY_BYTES = 16 * 1024;
const MAX_TOKEN_LENGTH = 4_096;
const MAX_TOKEN_TTL_MS = 2 * 60 * 60 * 1_000;
const MAX_REPOSITORIES = 500;
const MAX_PERMISSIONS = 100;
const MAX_TOKEN_RESPONSE_BYTES = 512 * 1024;

export interface GitHubAppCredentials {
  readonly appId: number;
  readonly privateKey: string;
  readonly nowMs?: number | undefined;
}

export interface GitHubAppRequest {
  request: (
    route: string,
    parameters: Record<string, unknown>
  ) => Promise<{ readonly data: unknown }>;
}

export interface InstallationAccessToken {
  readonly token: string;
  readonly expiresAt: string;
  readonly permissions: Readonly<Record<string, string>>;
  readonly repositoryIds: readonly number[];
}

function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function nowMs(credentials: GitHubAppCredentials): number {
  const value = credentials.nowMs ?? Date.now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PlatformError("GITHUB_APP_AUTH_INVALID", "GitHub App clock input is invalid.");
  }
  return value;
}

function validateCredentials(credentials: GitHubAppCredentials): number {
  if (
    !Number.isSafeInteger(credentials.appId) ||
    credentials.appId <= 0 ||
    typeof credentials.privateKey !== "string" ||
    credentials.privateKey.length === 0 ||
    Buffer.byteLength(credentials.privateKey, "utf8") > MAX_PRIVATE_KEY_BYTES
  ) {
    throw new PlatformError("GITHUB_APP_AUTH_INVALID", "GitHub App credentials are invalid.");
  }
  return nowMs(credentials);
}

export function createGitHubAppJwt(credentials: GitHubAppCredentials): string {
  const timestamp = validateCredentials(credentials);
  const issuedAt = Math.floor(timestamp / 1_000) - 60;
  const payload = {
    iss: String(credentials.appId),
    iat: issuedAt,
    exp: issuedAt + 540
  };
  const encodedHeader = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  try {
    const signature = createSign("RSA-SHA256")
      .update(signingInput)
      .end()
      .sign(credentials.privateKey);
    return `${signingInput}.${base64url(signature)}`;
  } catch {
    throw new PlatformError("GITHUB_APP_AUTH_INVALID", "GitHub App private key is invalid.");
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PlatformError("GITHUB_APP_AUTH_INVALID", "GitHub App token response is invalid.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    !/^[\x21-\x7e]+$/u.test(value)
  ) {
    throw new PlatformError("GITHUB_APP_AUTH_INVALID", "GitHub App token response is invalid.");
  }
  return value;
}

function safeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new PlatformError("GITHUB_APP_AUTH_INVALID", "GitHub App token response is invalid.");
  }
  return value as number;
}

export async function createInstallationAccessToken(
  client: GitHubAppRequest,
  credentials: GitHubAppCredentials,
  installationId: number
): Promise<InstallationAccessToken> {
  const timestamp = validateCredentials(credentials);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw new PlatformError(
      "GITHUB_APP_AUTH_INVALID",
      "GitHub installation identifier is invalid."
    );
  }
  const jwt = createGitHubAppJwt(credentials);
  let response: { readonly data: unknown };
  try {
    response = await client.request("POST /app/installations/{installation_id}/access_tokens", {
      installation_id: installationId,
      headers: {
        accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": API_VERSION
      }
    });
  } catch {
    throw new PlatformError("GITHUB_APP_AUTH_FAILED", "GitHub installation authentication failed.");
  }
  try {
    let responseBytes: string;
    try {
      responseBytes = JSON.stringify(response.data);
    } catch {
      throw new PlatformError("GITHUB_APP_AUTH_INVALID", "GitHub App token response is invalid.");
    }
    if (Buffer.byteLength(responseBytes, "utf8") > MAX_TOKEN_RESPONSE_BYTES) {
      throw new PlatformError("GITHUB_APP_AUTH_INVALID", "GitHub App token response is invalid.");
    }
    const data = object(response.data);
    const token = text(data.token, MAX_TOKEN_LENGTH);
    const expiresAt = text(data.expires_at, 128);
    const expiresAtMs = Date.parse(expiresAt);
    if (
      !Number.isSafeInteger(expiresAtMs) ||
      expiresAtMs <= timestamp ||
      expiresAtMs - timestamp > MAX_TOKEN_TTL_MS
    ) {
      throw new Error("invalid expiry");
    }
    const rawPermissions = object(data.permissions);
    if (Object.keys(rawPermissions).length > MAX_PERMISSIONS) {
      throw new Error("too many permissions");
    }
    const permissions: Record<string, string> = {};
    for (const [name, value] of Object.entries(rawPermissions)) {
      if (name.length === 0 || name.length > 128) {
        throw new Error("invalid permission name");
      }
      permissions[name] = text(value, 32);
    }
    const rawRepositories = data.repositories;
    const repositoryIds: number[] = [];
    if (rawRepositories !== undefined) {
      if (!Array.isArray(rawRepositories) || rawRepositories.length > MAX_REPOSITORIES) {
        throw new Error("invalid repositories");
      }
      for (const repository of rawRepositories) {
        repositoryIds.push(safeInteger(object(repository).id));
      }
    }
    return { token, expiresAt, permissions, repositoryIds };
  } catch (error) {
    if (error instanceof PlatformError) {
      throw error;
    }
    throw new PlatformError("GITHUB_APP_AUTH_INVALID", "GitHub App token response is invalid.");
  }
}
