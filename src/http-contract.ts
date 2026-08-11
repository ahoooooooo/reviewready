import {
  MAX_WEBHOOK_BODY_BYTES,
  receiveGitHubWebhook,
  type DurableWebhookStore,
  type GitHubWebhookConfig,
  type WebhookHeaderValue,
  type WebhookIngressReason
} from "./webhook.js";

export const MAX_HTTP_HEADER_VALUE_LENGTH = 512;

export interface WebhookHttpRequest {
  readonly method: string;
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<Record<string, WebhookHeaderValue | undefined>>;
  readonly receivedAtMs: number;
  readonly nowMs: number;
}

export interface WebhookHttpResponse {
  readonly status: 200 | 202 | 400 | 405 | 409 | 413 | 503;
  readonly body: {
    readonly accepted: boolean;
    readonly reason: WebhookIngressReason;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function headerValue(headers: unknown, wanted: string): string | null | undefined {
  if (!isRecord(headers)) {
    return null;
  }
  const values: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== wanted) {
      continue;
    }
    if (
      Array.isArray(value) ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > MAX_HTTP_HEADER_VALUE_LENGTH ||
      value.includes("\0")
    ) {
      return null;
    }
    values.push(value);
  }
  if (values.length > 1) {
    return null;
  }
  return values[0];
}

function response(
  status: WebhookHttpResponse["status"],
  accepted: boolean,
  reason: WebhookIngressReason
): WebhookHttpResponse {
  return { status, body: { accepted, reason } };
}

export async function handleGitHubWebhookHttp(
  request: WebhookHttpRequest,
  config: GitHubWebhookConfig,
  store: DurableWebhookStore
): Promise<WebhookHttpResponse> {
  if (!isRecord(request)) {
    return response(400, false, "invalid");
  }
  if (request.method !== "POST") {
    return response(405, false, "invalid");
  }
  if (!(request.rawBody instanceof Uint8Array)) {
    return response(400, false, "invalid");
  }
  if (request.rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return response(413, false, "invalid");
  }

  const contentType = headerValue(request.headers, "content-type");
  if (contentType !== "application/json") {
    return response(400, false, "invalid");
  }
  const contentLength = headerValue(request.headers, "content-length");
  if (contentLength === null) {
    return response(400, false, "invalid");
  }
  if (contentLength !== undefined) {
    if (!/^\d+$/u.test(contentLength)) {
      return response(400, false, "invalid");
    }
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length > MAX_WEBHOOK_BODY_BYTES) {
      return response(413, false, "invalid");
    }
    if (length !== request.rawBody.byteLength) {
      return response(400, false, "invalid");
    }
  }

  try {
    const ingress = await receiveGitHubWebhook(request, config, store);
    switch (ingress.reason) {
      case "accepted":
        return response(202, true, ingress.reason);
      case "duplicate":
        return response(200, false, ingress.reason);
      case "conflict":
        return response(409, false, ingress.reason);
      case "store_error":
        return response(503, false, ingress.reason);
      default:
        return response(400, false, "invalid");
    }
  } catch {
    return response(503, false, "store_error");
  }
}
