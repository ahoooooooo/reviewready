import { PlatformError } from "./errors.js";

const GITHUB_REQUEST_TIMEOUT_MS = 60_000;
const MAX_GITHUB_RETRIES = 1;
const MAX_RETRY_DELAY_MS = 2_000;
const decimalHeaderPattern = /^[0-9]+$/u;

export const INVALID_HEADER_VALUE = Symbol("invalid-header-value");
export const githubRequestSignal = (): AbortSignal =>
  AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS);

export function incompleteEvidence(kind: string, limit: number): PlatformError {
  return new PlatformError(
    "GITHUB_EVIDENCE_INCOMPLETE",
    `GitHub returned an incomplete or oversized ${kind} set; ReviewReady cannot evaluate it safely (limit: ${String(limit)}).`
  );
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const status = (error as { readonly status?: unknown }).status;
  return Number.isSafeInteger(status) ? (status as number) : undefined;
}

function errorHeaders(error: unknown): unknown {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const response = (error as { readonly response?: unknown }).response;
  if (typeof response !== "object" || response === null) {
    return undefined;
  }
  return (response as { readonly headers?: unknown }).headers;
}

export function headerValue(
  headers: unknown,
  name: string
): string | undefined | typeof INVALID_HEADER_VALUE {
  if (typeof headers !== "object" || headers === null) {
    return undefined;
  }
  let found: string | undefined;
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      if (typeof value !== "string" || found !== undefined) {
        return INVALID_HEADER_VALUE;
      }
      found = value;
    }
  }
  return found;
}

function retryDelay(error: unknown): number | undefined {
  const status = errorStatus(error);
  if (
    status !== 408 &&
    status !== 425 &&
    status !== 429 &&
    status !== 500 &&
    status !== 502 &&
    status !== 503 &&
    status !== 504 &&
    status !== 403
  ) {
    return undefined;
  }

  const headers = errorHeaders(error);
  const retryAfter = headerValue(headers, "retry-after");
  if (retryAfter === INVALID_HEADER_VALUE) {
    return undefined;
  }
  if (retryAfter !== undefined) {
    const retryAfterText = retryAfter.trim();
    if (!decimalHeaderPattern.test(retryAfterText)) {
      return undefined;
    }
    const seconds = Number(retryAfterText);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds * 1_000 > MAX_RETRY_DELAY_MS) {
      return undefined;
    }
    return Math.ceil(seconds * 1_000);
  }

  const remaining = headerValue(headers, "x-ratelimit-remaining");
  if (remaining === INVALID_HEADER_VALUE) {
    return undefined;
  }
  let remainingValue: number | undefined;
  if (remaining !== undefined) {
    const remainingText = remaining.trim();
    if (!decimalHeaderPattern.test(remainingText)) {
      return undefined;
    }
    remainingValue = Number(remainingText);
    if (!Number.isSafeInteger(remainingValue)) {
      return undefined;
    }
  }
  const reset = headerValue(headers, "x-ratelimit-reset");
  if (reset === INVALID_HEADER_VALUE) {
    return undefined;
  }
  if (remainingValue === 0 && reset !== undefined) {
    const resetText = reset.trim();
    if (!decimalHeaderPattern.test(resetText)) {
      return undefined;
    }
    const resetSeconds = Number(resetText);
    if (!Number.isSafeInteger(resetSeconds)) {
      return undefined;
    }
    const delay = resetSeconds * 1_000 - Date.now();
    return delay >= 0 && delay <= MAX_RETRY_DELAY_MS ? delay : undefined;
  }

  return status === 403 ? undefined : 100;
}

export async function withGitHubRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_GITHUB_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= MAX_GITHUB_RETRIES) {
        throw error;
      }
      const delay = retryDelay(error);
      if (delay === undefined) {
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("GitHub retry loop exhausted unexpectedly.");
}
