import { getOctokit } from "@actions/github";

import { MAX_AUDIT_SOURCE_BYTES, MAX_AUDIT_WORKFLOW_SOURCES } from "./github-audit.js";
import type {
  AuditBranchProtection,
  AuditGitHubClient,
  AuditRepositoryMetadata,
  AuditRuleset,
  AuditTagProtection,
  AuditWorkflowFile
} from "./github-audit.js";

const API_VERSION = "2026-03-10";
const API_ORIGIN = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 60_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_RULESETS = 100;
const MAX_API_REQUESTS = 768;
const MAX_RETRIES = 1;
const MAX_RETRY_DELAY_MS = 2_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_HEADER_VALUE_BYTES = 64 * 1024;
const MAX_DEADLINE_MS = 120_000;
const MAX_NESTED_ITEMS = 100;
const SHA = /^[0-9a-f]{40}$/iu;
const NON_NEGATIVE_INTEGER = /^[0-9]+$/u;
const RULESET_SUPPORTED_FIELDS = new Set([
  "id",
  "name",
  "target",
  "source_type",
  "source",
  "enforcement",
  "node_id",
  "_links",
  "created_at",
  "updated_at",
  "conditions",
  "rules",
  "bypass_actors"
]);

type RequestResponse = {
  readonly data: unknown;
  readonly headers?: unknown;
  readonly status?: number;
};
type PaginationIdentity = {
  readonly apiBaseUrl: string;
  readonly pathname: string;
  readonly fixedQuery: Readonly<Record<string, string>>;
};
type PageResult = {
  readonly items: readonly unknown[];
  readonly headers?: unknown;
  readonly pagination: PaginationIdentity;
};
type PageLinks = {
  readonly nextPage?: number;
  readonly hasLast: boolean;
  readonly lastPage?: number;
};
type RequestFunction = (
  route: string,
  parameters: Record<string, unknown>
) => Promise<RequestResponse>;
type FetchImplementation = (
  ...arguments_: Parameters<typeof globalThis.fetch>
) => ReturnType<typeof globalThis.fetch>;
type RequestWithDefaults = RequestFunction & {
  readonly endpoint?: {
    readonly DEFAULTS?: {
      readonly baseUrl?: string;
      readonly request?: { readonly fetch?: FetchImplementation };
    };
  };
  readonly defaults?: (defaults: Record<string, unknown>) => RequestFunction;
};

export interface GitHubAuditApiOptions {
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
  readonly deadlineMs?: number;
}

export class AuditApiFailure extends Error {
  public readonly response?: { readonly headers?: unknown };

  public constructor(
    public readonly code: string,
    public readonly status?: number,
    responseHeaders?: unknown
  ) {
    super(code);
    if (responseHeaders !== undefined) {
      this.response = { headers: responseHeaders };
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AuditApiFailure("response-object-invalid");
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown, max = 512): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    /[\p{Control}\p{Format}\p{Surrogate}\u2028\u2029]/u.test(value)
  ) {
    throw new AuditApiFailure("response-string-invalid");
  }
  return value;
}

function shaField(value: unknown): string {
  const candidate = stringField(value, 128);
  if (!SHA.test(candidate)) {
    throw new AuditApiFailure("response-sha-invalid");
  }
  return candidate;
}

function booleanField(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new AuditApiFailure("response-boolean-invalid");
  }
  return value;
}

function integerField(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new AuditApiFailure("response-integer-invalid");
  }
  return value as number;
}

function appIdField(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 2_147_483_647) {
    throw new AuditApiFailure("response-app-id-invalid");
  }
  return value as number;
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (typeof headers !== "object" || headers === null) {
    return undefined;
  }
  let found: string | undefined;
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== name.toLowerCase()) {
      continue;
    }
    if (typeof value !== "string" || found !== undefined) {
      throw new AuditApiFailure("response-header-invalid");
    }
    if (Buffer.byteLength(value, "utf8") > MAX_HEADER_VALUE_BYTES) {
      throw new AuditApiFailure("response-header-limit");
    }
    found = value;
  }
  return found;
}

function validateResponseSize(response: RequestResponse): void {
  const contentLength = headerValue(response.headers, "content-length");
  if (contentLength !== undefined) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new AuditApiFailure("response-header-invalid");
    }
    if (parsed > MAX_RESPONSE_BYTES) {
      throw new AuditApiFailure("response-size-limit");
    }
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(response.data);
  } catch {
    throw new AuditApiFailure("response-data-invalid");
  }
  if (typeof serialized !== "string") {
    throw new AuditApiFailure("response-data-invalid");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_RESPONSE_BYTES) {
    throw new AuditApiFailure("response-size-limit");
  }
}

function responseFailure(response: Response, status: number): Response {
  return new Response("", {
    status,
    statusText: "ReviewReady bounded response rejected",
    headers: response.headers
  });
}

async function cancelReader(reader: ByteStreamReader): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    return;
  }
}

function copyStreamChunk(value: unknown, remainingBytes: number): Uint8Array | undefined {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError("response chunk is not a Uint8Array");
  }
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    "byteLength"
  );
  if (descriptor?.get === undefined) {
    throw new TypeError("typed-array byteLength getter is unavailable");
  }
  const length: unknown = descriptor.get.call(value);
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    throw new TypeError("response chunk byteLength is invalid");
  }
  if (length > remainingBytes) {
    return undefined;
  }
  const copy = new Uint8Array(length);
  Uint8Array.prototype.set.call(copy, value);
  return copy;
}

async function boundedResponse(response: Response): Promise<Response> {
  const contentLength = response.headers.get("content-length");
  let failureStatus: number | undefined;
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      failureStatus = 502;
    } else if (parsed > MAX_RESPONSE_BYTES) {
      failureStatus = 413;
    }
  }
  const source = response.body as unknown;
  if (source === null || source === undefined) {
    return failureStatus === undefined ? response : responseFailure(response, failureStatus);
  }
  const reader = (source as { readonly getReader: () => ByteStreamReader }).getReader();
  if (failureStatus !== undefined) {
    await cancelReader(reader);
    return responseFailure(response, failureStatus);
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      let copy: Uint8Array;
      try {
        const copied = copyStreamChunk(chunk.value, MAX_RESPONSE_BYTES - bytes);
        if (copied === undefined) {
          await cancelReader(reader);
          return responseFailure(response, 413);
        }
        copy = copied;
      } catch {
        await cancelReader(reader);
        return responseFailure(response, 502);
      }
      if (bytes + copy.byteLength > MAX_RESPONSE_BYTES) {
        await cancelReader(reader);
        return responseFailure(response, 413);
      }
      bytes += copy.byteLength;
      chunks.push(copy);
      chunk = await reader.read();
    }
  } catch (error) {
    await cancelReader(reader);
    throw error;
  }
  return new Response(Buffer.concat(chunks), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

interface ByteStreamReader {
  read: () => Promise<{ readonly done: boolean; readonly value?: unknown }>;
  cancel: (reason?: unknown) => Promise<unknown>;
}

function boundedFetch(fetchImplementation: FetchImplementation): FetchImplementation {
  return async (...arguments_) => boundedResponse(await fetchImplementation(...arguments_));
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

function retryDelay(error: unknown, now: number): number | undefined {
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
  if (retryAfter !== undefined) {
    if (retryAfter.trim() === "") {
      return undefined;
    }
    const seconds = Number(retryAfter);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds * 1_000 > MAX_RETRY_DELAY_MS) {
      return undefined;
    }
    return Math.ceil(seconds * 1_000);
  }
  const remaining = headerValue(headers, "x-ratelimit-remaining");
  const reset = headerValue(headers, "x-ratelimit-reset");
  let remainingValue: number | undefined;
  if (remaining !== undefined) {
    const remainingText = remaining.trim();
    if (!NON_NEGATIVE_INTEGER.test(remainingText) || !Number.isSafeInteger(Number(remainingText))) {
      return undefined;
    }
    remainingValue = Number(remainingText);
  }
  let resetSeconds: number | undefined;
  if (reset !== undefined) {
    const resetValue = reset.trim();
    if (!NON_NEGATIVE_INTEGER.test(resetValue)) {
      return undefined;
    }
    resetSeconds = Number(resetValue);
    if (!Number.isSafeInteger(resetSeconds)) {
      return undefined;
    }
  }
  if (remainingValue === 0 && reset !== undefined) {
    if (resetSeconds === undefined) {
      return undefined;
    }
    const delay = resetSeconds * 1_000 - now;
    return delay >= 0 && delay <= MAX_RETRY_DELAY_MS ? delay : undefined;
  }
  return status === 403 ? undefined : 100;
}

function normalizeApiBaseUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    /[\p{Control}\p{Format}\p{Surrogate}\u2028\u2029]/u.test(value)
  ) {
    throw new AuditApiFailure("api-base-url-invalid");
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      throw new AuditApiFailure("api-base-url-invalid");
    }
    const path = parsed.pathname.replace(/\/+$/u, "");
    return `${parsed.origin}${path}`;
  } catch (error) {
    if (error instanceof AuditApiFailure) {
      throw error;
    }
    throw new AuditApiFailure("api-base-url-invalid");
  }
}

function nextPage(headers: unknown, identity: PaginationIdentity): PageLinks {
  const link = headerValue(headers, "link");
  if (link === undefined) {
    return { hasLast: false };
  }
  if (link.trim() === "") {
    throw new AuditApiFailure("pagination-link-invalid");
  }
  const entries = [
    ...link.matchAll(/<([^<>]+)>\s*;\s*rel=(?:"([^"]*)"|'([^']*)'|([^\s,;]+))(?=\s*(?:,|$))/giu)
  ];
  let offset = 0;
  for (const entry of entries) {
    const start = entry.index;
    if (link.slice(offset, start).trim() !== (offset === 0 ? "" : ",")) {
      throw new AuditApiFailure("pagination-link-invalid");
    }
    offset = start + entry[0].length;
  }
  if (entries.length === 0 || link.slice(offset).trim() !== "") {
    throw new AuditApiFailure("pagination-link-invalid");
  }
  const relations = entries.map((entry) => entry[2] ?? entry[3] ?? entry[4]);
  if (
    relations.some(
      (relation) => relation === undefined || relation.trim() === "" || /\s/u.test(relation)
    )
  ) {
    throw new AuditApiFailure("pagination-link-ambiguous");
  }
  const nextEntries = entries.filter(
    (entry) => (entry[2] ?? entry[3] ?? entry[4])?.toLowerCase() === "next"
  );
  const lastEntries = entries.filter(
    (entry) => (entry[2] ?? entry[3] ?? entry[4])?.toLowerCase() === "last"
  );
  if (nextEntries.length > 1 || lastEntries.length > 1) {
    throw new AuditApiFailure("pagination-link-ambiguous");
  }
  const pageFromEntry = (entry: RegExpMatchArray | undefined): number => {
    try {
      const baseUrl = new URL(identity.apiBaseUrl);
      const basePath = baseUrl.pathname === "/" ? "" : baseUrl.pathname;
      const url = new URL(entry?.[1] ?? "", identity.apiBaseUrl);
      if (
        url.origin !== baseUrl.origin ||
        url.username.length > 0 ||
        url.password.length > 0 ||
        url.hash.length > 0 ||
        url.pathname !== `${basePath}${identity.pathname}`
      ) {
        throw new AuditApiFailure("pagination-link-invalid");
      }
      const queryEntries = [...url.searchParams.entries()];
      const expectedKeys = new Set(["page", ...Object.keys(identity.fixedQuery)]);
      if (
        queryEntries.length !== expectedKeys.size ||
        queryEntries.some(([key]) => !expectedKeys.has(key)) ||
        new Set(queryEntries.map(([key]) => key)).size !== queryEntries.length
      ) {
        throw new AuditApiFailure("pagination-link-invalid");
      }
      for (const [key, expected] of Object.entries(identity.fixedQuery)) {
        if (url.searchParams.get(key) !== expected) {
          throw new AuditApiFailure("pagination-link-invalid");
        }
      }
      const pages = url.searchParams.getAll("page");
      if (pages.length !== 1 || !/^[1-9]\d*$/u.test(pages[0] ?? "")) {
        throw new AuditApiFailure("pagination-link-invalid");
      }
      const parsed = Number(pages[0]);
      if (!Number.isSafeInteger(parsed)) {
        throw new AuditApiFailure("pagination-link-invalid");
      }
      return parsed;
    } catch (error) {
      if (error instanceof AuditApiFailure) {
        throw error;
      }
      throw new AuditApiFailure("pagination-link-invalid");
    }
  };
  const nextEntry = nextEntries[0];
  const lastEntry = lastEntries[0];
  return {
    hasLast: lastEntry !== undefined,
    ...(nextEntry === undefined ? {} : { nextPage: pageFromEntry(nextEntry) }),
    ...(lastEntry === undefined ? {} : { lastPage: pageFromEntry(lastEntry) })
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = Array.from({ length: values.length });
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(values[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

function actor(
  value: unknown,
  bypassMode: "always" | "exempt" | "pull_request" | undefined
): AuditRuleset["bypassActors"][number] {
  const item = record(value);
  if (
    Object.keys(item).some(
      (key) => key !== "actor_type" && key !== "actor_id" && key !== "bypass_mode"
    )
  ) {
    throw new AuditApiFailure("ruleset-bypass-field-unsupported");
  }
  const wireType = item.actor_type;
  const actorId = item.actor_id;
  if (typeof wireType !== "string") {
    throw new AuditApiFailure("actor-identity-invalid");
  }
  let actorType:
    "user" | "team" | "integration" | "organization_admin" | "repository_role" | "deploy_key";
  let type: "user" | "team" | "app" | "integration";
  let id: string;
  if (wireType === "User" || wireType === "Team" || wireType === "Integration") {
    if (!Number.isSafeInteger(actorId) || (actorId as number) < 1) {
      throw new AuditApiFailure("actor-identity-invalid");
    }
    id = String(actorId);
    actorType = wireType === "User" ? "user" : wireType === "Team" ? "team" : "integration";
    type = wireType === "User" ? "user" : wireType === "Team" ? "team" : "integration";
  } else if (wireType === "RepositoryRole") {
    if (!Number.isSafeInteger(actorId) || (actorId as number) < 1) {
      throw new AuditApiFailure("actor-identity-invalid");
    }
    id = String(actorId);
    actorType = "repository_role";
    type = "app";
  } else if (wireType === "OrganizationAdmin") {
    if (
      !Object.prototype.hasOwnProperty.call(item, "actor_id") ||
      (actorId !== null && (!Number.isSafeInteger(actorId) || (actorId as number) < 1))
    ) {
      throw new AuditApiFailure("actor-identity-invalid");
    }
    id = "organizationadmin";
    actorType = "organization_admin";
    type = "app";
  } else if (wireType === "DeployKey") {
    if (!Object.prototype.hasOwnProperty.call(item, "actor_id") || actorId !== null) {
      throw new AuditApiFailure("actor-identity-invalid");
    }
    id = "deploykey";
    actorType = "deploy_key";
    type = "app";
  } else {
    throw new AuditApiFailure("actor-identity-invalid");
  }
  return {
    id,
    type,
    actorType,
    ...(bypassMode === undefined ? {} : { bypassMode })
  };
}

function check(
  value: unknown,
  integrationField: string
): { readonly name: string; readonly appId?: number } {
  const item = record(value);
  rejectUnknownFields(
    item,
    ["context", "name", integrationField],
    "branch-protection-semantics-unsupported"
  );
  const hasContext = Object.prototype.hasOwnProperty.call(item, "context");
  const hasName = Object.prototype.hasOwnProperty.call(item, "name");
  let name: string;
  if (hasContext && hasName) {
    const contextName = stringField(item.context);
    const explicitName = stringField(item.name);
    if (contextName !== explicitName) {
      throw new AuditApiFailure("required-checks-ambiguous");
    }
    name = contextName;
  } else {
    name = stringField(hasContext ? item.context : item.name);
  }
  const appId = item[integrationField];
  if (appId === null || appId === undefined) {
    return { name };
  }
  return { name, appId: appIdField(appId) };
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: string
): void {
  const allowedFields = new Set(allowed);
  if (Object.keys(value).some((field) => !allowedFields.has(field))) {
    throw new AuditApiFailure(code);
  }
}

function checksFromBranchProtection(value: unknown): AuditBranchProtection["requiredStatusChecks"] {
  if (value === null) {
    return null;
  }
  const item = record(value);
  rejectUnknownFields(
    item,
    ["url", "contexts_url", "strict", "checks", "contexts"],
    "branch-protection-semantics-unsupported"
  );
  const strict = booleanField(item.strict);
  const checks: { readonly name: string; readonly appId?: number }[] = [];
  let hasStructuredChecks = false;
  let hasChecksField = false;
  let structuredChecks: { readonly name: string; readonly appId?: number }[] = [];
  if (item.checks !== undefined) {
    hasChecksField = true;
    if (!Array.isArray(item.checks)) {
      throw new AuditApiFailure("required-checks-invalid");
    }
    if (item.checks.length > MAX_NESTED_ITEMS) {
      throw new AuditApiFailure("required-checks-limit");
    }
    if (item.checks.length > 0) {
      hasStructuredChecks = true;
      structuredChecks = item.checks.map((entry) => check(entry, "app_id"));
    }
  }
  let legacyContexts: string[] | undefined;
  if (item.contexts !== undefined) {
    if (!Array.isArray(item.contexts)) {
      throw new AuditApiFailure("required-contexts-invalid");
    }
    if (item.contexts.length > MAX_NESTED_ITEMS) {
      throw new AuditApiFailure("required-contexts-limit");
    }
    if (item.contexts.some((entry) => typeof entry !== "string")) {
      throw new AuditApiFailure("required-contexts-invalid");
    }
    legacyContexts = item.contexts.map((entry) => stringField(entry));
  }
  if (hasStructuredChecks && legacyContexts !== undefined) {
    const structuredNames = structuredChecks.map((entry) => entry.name).sort();
    const legacyNames = [...legacyContexts].sort();
    if (JSON.stringify(structuredNames) !== JSON.stringify(legacyNames)) {
      throw new AuditApiFailure("required-checks-ambiguous");
    }
  }
  if (hasStructuredChecks) {
    checks.push(...structuredChecks);
  } else if (legacyContexts !== undefined) {
    checks.push(...legacyContexts.map((entry) => ({ name: entry })));
  }
  if (!hasChecksField && item.contexts === undefined) {
    throw new AuditApiFailure("required-checks-invalid");
  }
  return { strict, checks };
}

function reviewBypassActors(value: unknown): {
  readonly actors: NonNullable<AuditBranchProtection["requiredPullRequestReviews"]>["bypassActors"];
  readonly known: boolean;
} {
  const item = record(value);
  const allowance = item.bypass_pull_request_allowances;
  if (allowance === undefined || allowance === null) {
    return { actors: [], known: false };
  }
  const data = record(allowance);
  if (
    Object.keys(data).some((field) => field !== "users" && field !== "teams" && field !== "apps")
  ) {
    throw new AuditApiFailure("review-bypass-field-unsupported");
  }
  const result: { readonly id: string; readonly type?: "user" | "team" | "app" | "integration" }[] =
    [];
  const identities = new Set<string>();
  let complete = true;
  for (const [field, type] of [
    ["users", "user"],
    ["teams", "team"],
    ["apps", "app"]
  ] as const) {
    const values = data[field];
    if (values === undefined) {
      complete = false;
      continue;
    }
    if (!Array.isArray(values)) {
      throw new AuditApiFailure("review-bypass-invalid");
    }
    if (values.length > MAX_NESTED_ITEMS) {
      throw new AuditApiFailure("review-bypass-limit");
    }
    for (const entry of values) {
      const item = record(entry);
      const id = item.id;
      if (!Number.isSafeInteger(id) || (id as number) < 1) {
        throw new AuditApiFailure("actor-identity-invalid");
      }
      const identity = type + "\u0000" + String(id);
      if (identities.has(identity)) {
        throw new AuditApiFailure("review-bypass-duplicate");
      }
      identities.add(identity);
      result.push({
        id: String(id),
        type
      });
      if (result.length > MAX_NESTED_ITEMS) {
        throw new AuditApiFailure("review-bypass-limit");
      }
    }
  }
  return { actors: result, known: complete };
}

function mapBranchProtection(value: unknown, branch: string): AuditBranchProtection {
  const item = record(value);
  rejectUnknownFields(
    item,
    [
      "url",
      "required_status_checks",
      "enforce_admins",
      "required_pull_request_reviews",
      "restrictions",
      "required_linear_history",
      "allow_force_pushes",
      "allow_deletions",
      "required_conversation_resolution",
      "lock_branch",
      "allow_fork_syncing"
    ],
    "branch-protection-semantics-unsupported"
  );
  if (
    "restrictions" in item ||
    "required_linear_history" in item ||
    "required_conversation_resolution" in item ||
    "lock_branch" in item ||
    "allow_fork_syncing" in item
  ) {
    throw new AuditApiFailure("branch-protection-semantics-unsupported");
  }
  const admins = record(item.enforce_admins);
  const forcePushes = record(item.allow_force_pushes);
  const deletions = record(item.allow_deletions);
  for (const nested of [admins, forcePushes, deletions]) {
    rejectUnknownFields(nested, ["url", "enabled"], "branch-protection-semantics-unsupported");
  }
  const reviews = item.required_pull_request_reviews;
  const reviewRules =
    reviews === null
      ? null
      : (() => {
          const data = record(reviews);
          rejectUnknownFields(
            data,
            [
              "url",
              "required_approving_review_count",
              "bypass_pull_request_allowances",
              "dismissal_restrictions",
              "dismiss_stale_reviews",
              "require_code_owner_reviews",
              "require_last_push_approval"
            ],
            "branch-protection-semantics-unsupported"
          );
          if (
            "dismissal_restrictions" in data ||
            "dismiss_stale_reviews" in data ||
            "require_code_owner_reviews" in data ||
            "require_last_push_approval" in data
          ) {
            throw new AuditApiFailure("branch-protection-semantics-unsupported");
          }
          const bypass = reviewBypassActors(data);
          return {
            requiredApprovingReviewCount: integerField(data.required_approving_review_count),
            bypassActors: bypass.actors,
            bypassActorsKnown: bypass.known
          };
        })();
  return {
    branch,
    exists: true,
    enforceAdmins: booleanField(admins.enabled),
    allowForcePushes: booleanField(forcePushes.enabled),
    allowDeletions: booleanField(deletions.enabled),
    requiredStatusChecks: checksFromBranchProtection(item.required_status_checks),
    requiredPullRequestReviews: reviewRules
  };
}

function rulesetChecks(value: unknown): { readonly name: string; readonly appId?: number }[] {
  const parameters = record(value);
  if (Object.keys(parameters).some((key) => key !== "required_status_checks")) {
    throw new AuditApiFailure("ruleset-status-semantics-unsupported");
  }
  const values = parameters.required_status_checks;
  if (!Array.isArray(values)) {
    throw new AuditApiFailure("ruleset-checks-invalid");
  }
  if (values.length > MAX_NESTED_ITEMS) {
    throw new AuditApiFailure("ruleset-checks-limit");
  }
  return values.map((entry) => check(entry, "integration_id"));
}

function validateRulesetMetadata(
  item: Record<string, unknown>,
  ownerType: "organization" | "user" | undefined,
  owner: string | undefined,
  repo: string | undefined
): void {
  const sourceType = item.source_type;
  const source = item.source;
  if ((sourceType === undefined) !== (source === undefined)) {
    throw new AuditApiFailure("ruleset-source-invalid");
  }
  if (sourceType !== undefined || source !== undefined) {
    if (sourceType !== "Repository" && sourceType !== "Organization") {
      throw new AuditApiFailure("ruleset-source-invalid");
    }
    const sourceText = stringField(source, 512);
    if (sourceType === "Repository") {
      if (
        owner === undefined ||
        repo === undefined ||
        sourceText.toLowerCase() !== `${owner}/${repo}`.toLowerCase()
      ) {
        throw new AuditApiFailure("ruleset-source-mismatch");
      }
    } else if (
      ownerType !== "organization" ||
      owner === undefined ||
      sourceText.toLowerCase() !== owner.toLowerCase()
    ) {
      throw new AuditApiFailure("ruleset-source-mismatch");
    }
  }
  if (item.node_id !== undefined) {
    stringField(item.node_id, 512);
  }
  for (const field of ["created_at", "updated_at"] as const) {
    const value = item[field];
    if (value !== undefined) {
      const timestamp = stringField(value, 128);
      if (!Number.isFinite(Date.parse(timestamp))) {
        throw new AuditApiFailure("ruleset-metadata-invalid");
      }
    }
  }
  if (item._links !== undefined) {
    const links = record(item._links);
    for (const key of Object.keys(links)) {
      if (key !== "self" && key !== "html") {
        throw new AuditApiFailure("ruleset-metadata-invalid");
      }
      const link = record(links[key]);
      if (Object.keys(link).some((field) => field !== "href")) {
        throw new AuditApiFailure("ruleset-metadata-invalid");
      }
      const href = stringField(link.href, 2048);
      try {
        const parsed = new URL(href);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          throw new Error("unsupported link protocol");
        }
      } catch {
        throw new AuditApiFailure("ruleset-metadata-invalid");
      }
    }
  }
}

function mapRuleset(
  value: unknown,
  expectedId?: number,
  ownerType?: "organization" | "user",
  owner?: string,
  repo?: string
): AuditRuleset {
  const item = record(value);
  if (Object.keys(item).some((key) => !RULESET_SUPPORTED_FIELDS.has(key))) {
    throw new AuditApiFailure("ruleset-field-unsupported");
  }
  validateRulesetMetadata(item, ownerType, owner, repo);
  const target = item.target;
  if (target !== "branch" && target !== "tag" && target !== "push" && target !== "repository") {
    throw new AuditApiFailure("ruleset-target-invalid");
  }
  const enforcement = item.enforcement;
  if (enforcement !== "active" && enforcement !== "evaluate" && enforcement !== "disabled") {
    throw new AuditApiFailure("ruleset-enforcement-invalid");
  }
  if (target === "repository" && enforcement === "evaluate") {
    throw new AuditApiFailure("ruleset-enforcement-invalid");
  }
  const conditions = record(item.conditions);
  const supportedConditionFields =
    target === "repository"
      ? ["repository_name"]
      : target === "push"
        ? ["repository_name"]
        : ["ref_name", "repository_name"];
  for (const field of Object.keys(conditions)) {
    if (!supportedConditionFields.includes(field)) {
      throw new AuditApiFailure("ruleset-scope-unsupported");
    }
  }
  const includes =
    target === "branch" || target === "tag"
      ? (() => {
          const refName = record(conditions.ref_name);
          for (const field of Object.keys(refName)) {
            if (field !== "include" && field !== "exclude") {
              throw new AuditApiFailure("ruleset-scope-unsupported");
            }
          }
          const rawValues = refName.include;
          if (!Array.isArray(rawValues)) {
            throw new AuditApiFailure("ruleset-scope-invalid");
          }
          if (rawValues.length > MAX_NESTED_ITEMS) {
            throw new AuditApiFailure("ruleset-scope-limit");
          }
          const values: string[] = [];
          for (const value of rawValues) {
            if (typeof value !== "string") {
              throw new AuditApiFailure("ruleset-scope-invalid");
            }
            values.push(value);
          }
          const excluded = refName.exclude;
          if (excluded !== undefined) {
            if (!Array.isArray(excluded) || excluded.some((entry) => typeof entry !== "string")) {
              throw new AuditApiFailure("ruleset-scope-invalid");
            }
            if (excluded.length > MAX_NESTED_ITEMS) {
              throw new AuditApiFailure("ruleset-scope-limit");
            }
            if (excluded.length > 0) {
              throw new AuditApiFailure("ruleset-scope-unsupported");
            }
          }
          return values;
        })()
      : [];
  const repositoryName = conditions.repository_name;
  let repositoryPatterns: string[] | undefined;
  if (target === "repository" && repositoryName === undefined) {
    throw new AuditApiFailure("ruleset-scope-unsupported");
  }
  if (repositoryName !== undefined) {
    const repositoryScope = record(repositoryName);
    for (const field of Object.keys(repositoryScope)) {
      if (field !== "include" && field !== "exclude") {
        throw new AuditApiFailure("ruleset-scope-unsupported");
      }
    }
    const repositoryIncludes = repositoryScope.include;
    if (
      !Array.isArray(repositoryIncludes) ||
      repositoryIncludes.some((entry) => typeof entry !== "string")
    ) {
      throw new AuditApiFailure("ruleset-repository-scope-invalid");
    }
    if (repositoryIncludes.length === 0) {
      throw new AuditApiFailure("ruleset-repository-scope-invalid");
    }
    if (repositoryIncludes.length > MAX_NESTED_ITEMS) {
      throw new AuditApiFailure("ruleset-repository-scope-limit");
    }
    const repositoryExcludes = repositoryScope.exclude;
    if (repositoryExcludes !== undefined) {
      if (
        !Array.isArray(repositoryExcludes) ||
        repositoryExcludes.some((entry) => typeof entry !== "string")
      ) {
        throw new AuditApiFailure("ruleset-repository-scope-invalid");
      }
      if (repositoryExcludes.length > MAX_NESTED_ITEMS) {
        throw new AuditApiFailure("ruleset-repository-scope-limit");
      }
      if (repositoryExcludes.length > 0) {
        throw new AuditApiFailure("ruleset-scope-unsupported");
      }
    }
    repositoryPatterns = repositoryIncludes.map((entry) => stringField(entry));
  }
  const rules = item.rules;
  if (!Array.isArray(rules)) {
    throw new AuditApiFailure("ruleset-rules-invalid");
  }
  if (rules.length > MAX_NESTED_ITEMS) {
    throw new AuditApiFailure("ruleset-rules-limit");
  }
  let allowForcePushes: boolean | undefined;
  let allowDeletions: boolean | undefined;
  if (target === "branch" || target === "tag") {
    allowForcePushes = true;
    allowDeletions = true;
  }
  const requiredChecks: { readonly name: string; readonly appId?: number }[] = [];
  for (const rawRule of rules) {
    const rule = record(rawRule);
    const ruleType = rule.type;
    if (ruleType === "pull_request") {
      throw new AuditApiFailure("ruleset-review-semantics-unsupported");
    }
    if (
      ruleType !== "non_fast_forward" &&
      ruleType !== "deletion" &&
      ruleType !== "required_status_checks"
    ) {
      throw new AuditApiFailure("ruleset-rule-unsupported");
    }
    if (ruleType === "non_fast_forward" || ruleType === "deletion") {
      if (Object.keys(rule).some((key) => key !== "type")) {
        throw new AuditApiFailure("ruleset-rule-parameters");
      }
    }
    if (ruleType === "non_fast_forward" && allowForcePushes !== undefined) {
      allowForcePushes = false;
    }
    if (ruleType === "deletion" && allowDeletions !== undefined) {
      allowDeletions = false;
    }
    if (ruleType === "required_status_checks") {
      if (
        Object.keys(rule).some((key) => key !== "type" && key !== "parameters") ||
        !Object.prototype.hasOwnProperty.call(rule, "parameters")
      ) {
        throw new AuditApiFailure("ruleset-rule-parameters");
      }
      const checks = rulesetChecks(rule.parameters);
      if (requiredChecks.length + checks.length > MAX_NESTED_ITEMS) {
        throw new AuditApiFailure("ruleset-checks-limit");
      }
      requiredChecks.push(...checks);
    }
  }
  const rawBypass = item.bypass_actors;
  if (rawBypass !== undefined && !Array.isArray(rawBypass)) {
    throw new AuditApiFailure("ruleset-bypass-invalid");
  }
  const bypassActorsKnown = Array.isArray(rawBypass);
  if (bypassActorsKnown && rawBypass.length > MAX_NESTED_ITEMS) {
    throw new AuditApiFailure("ruleset-bypass-limit");
  }
  const bypassActors: AuditRuleset["bypassActors"] = [];
  if (bypassActorsKnown) {
    const identities = new Set<string>();
    for (const rawActor of rawBypass) {
      const actorItem = record(rawActor);
      const rawMode = actorItem.bypass_mode;
      const parsedMode =
        rawMode === "always" || rawMode === "exempt" || rawMode === "pull_request"
          ? rawMode
          : undefined;
      const mapped = actor(rawActor, parsedMode);
      if (parsedMode === undefined) {
        throw new AuditApiFailure("bypass-mode-invalid");
      }
      const mappedActorType = mapped.actorType;
      if (mappedActorType === undefined) {
        throw new AuditApiFailure("actor-identity-invalid");
      }
      if (mappedActorType === "organization_admin" && ownerType !== "organization") {
        throw new AuditApiFailure("owner-type-invalid");
      }
      if (
        parsedMode === "pull_request" &&
        (target !== "branch" || mappedActorType === "deploy_key")
      ) {
        throw new AuditApiFailure("bypass-mode-invalid");
      }
      const identity = mappedActorType + "\u0000" + mapped.id;
      if (identities.has(identity)) {
        throw new AuditApiFailure("ruleset-bypass-duplicate");
      }
      identities.add(identity);
      bypassActors.push(mapped);
    }
  }
  const id = integerField(item.id, 1);
  if (expectedId !== undefined && id !== expectedId) {
    throw new AuditApiFailure("ruleset-id-mismatch");
  }
  return {
    id,
    name: stringField(item.name),
    target,
    refPatterns: includes.map((entry) => stringField(entry)),
    ...(repositoryPatterns === undefined ? {} : { repositoryPatterns }),
    enforcement,
    bypassActors,
    bypassActorsKnown,
    allowForcePushes,
    allowDeletions,
    requiredChecks
  };
}

async function collectPages(
  requestPage: (page: number) => Promise<PageResult>,
  maxItems: number,
  kind: string,
  shortUnlinkedPageComplete = false
): Promise<unknown[]> {
  const result: unknown[] = [];
  let declaredLastPage: number | undefined;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const pageResult = await requestPage(page);
    if (pageResult.items.length > PAGE_SIZE || result.length + pageResult.items.length > maxItems) {
      throw new AuditApiFailure(`${kind}-limit`);
    }
    result.push(...pageResult.items);
    const links = nextPage(pageResult.headers, pageResult.pagination);
    if (links.nextPage !== undefined) {
      if (links.hasLast) {
        if (links.lastPage === undefined) {
          throw new AuditApiFailure(`${kind}-pagination-invalid`);
        }
        if (declaredLastPage !== undefined && links.lastPage !== declaredLastPage) {
          throw new AuditApiFailure(`${kind}-pagination-invalid`);
        }
        declaredLastPage = links.lastPage;
      } else if (declaredLastPage !== undefined && page < declaredLastPage) {
        throw new AuditApiFailure(`${kind}-pagination-invalid`);
      }
      if (
        links.nextPage !== page + 1 ||
        (declaredLastPage !== undefined && declaredLastPage < page + 1) ||
        page === MAX_PAGES
      ) {
        throw new AuditApiFailure(`${kind}-pagination-invalid`);
      }
      continue;
    }
    if (links.hasLast) {
      if (links.lastPage === undefined) {
        throw new AuditApiFailure(`${kind}-pagination-invalid`);
      }
      if (declaredLastPage !== undefined && links.lastPage !== declaredLastPage) {
        throw new AuditApiFailure(`${kind}-pagination-invalid`);
      }
      declaredLastPage = links.lastPage;
    } else if (declaredLastPage !== undefined && page < declaredLastPage) {
      throw new AuditApiFailure(`${kind}-pagination-invalid`);
    }
    if (declaredLastPage !== undefined && declaredLastPage !== page) {
      throw new AuditApiFailure(`${kind}-pagination-invalid`);
    }
    if (page === MAX_PAGES) {
      throw new AuditApiFailure(`${kind}-pagination-limit`);
    }
    const extra = await requestPage(page + 1);
    const extraLinks = nextPage(extra.headers, extra.pagination);
    if (
      shortUnlinkedPageComplete &&
      pageResult.items.length < PAGE_SIZE &&
      extraLinks.nextPage === undefined &&
      !extraLinks.hasLast &&
      extra.items.length === 0
    ) {
      return result;
    }
    if (extra.items.length > 0 || extraLinks.nextPage !== undefined || extraLinks.hasLast) {
      throw new AuditApiFailure(`${kind}-pagination-ambiguous`);
    }
    return result;
  }
  throw new AuditApiFailure(`${kind}-pagination-limit`);
}

export function createGitHubAuditClient(
  token: string,
  options: GitHubAuditApiOptions = {}
): AuditGitHubClient {
  if (typeof token !== "string" || token.length === 0 || token.length > 16_384) {
    throw new AuditApiFailure("token-invalid");
  }
  const octokit = getOctokit(token, {
    request: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  });
  const rawRequest = octokit.request as unknown as RequestWithDefaults | null | undefined;
  const configuredBaseUrl = normalizeApiBaseUrl(
    rawRequest?.endpoint?.DEFAULTS?.baseUrl ?? API_ORIGIN
  );
  const configuredFetch = rawRequest?.endpoint?.DEFAULTS?.request?.fetch;
  const defaultFetch = typeof configuredFetch === "function" ? configuredFetch : globalThis.fetch;
  const boundedTransport =
    typeof defaultFetch === "function" ? boundedFetch(defaultFetch) : undefined;
  const responseBoundaryAvailable = boundedTransport !== undefined;
  let request = rawRequest as RequestFunction;
  if (responseBoundaryAvailable && typeof rawRequest?.defaults === "function") {
    request = rawRequest.defaults({ request: { fetch: boundedTransport } });
  }
  if (typeof request !== "function") {
    throw new AuditApiFailure("request-unavailable");
  }
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? MAX_DEADLINE_MS;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > MAX_DEADLINE_MS) {
    throw new AuditApiFailure("deadline-invalid");
  }
  const startedAt = now();
  if (
    !Number.isSafeInteger(startedAt) ||
    startedAt < 0 ||
    startedAt + deadlineMs > Number.MAX_SAFE_INTEGER
  ) {
    throw new AuditApiFailure("clock-invalid");
  }
  const deadlineAt = startedAt + deadlineMs;
  let latestNow = startedAt;
  const monotonicNow = (): number => {
    const observed = now();
    if (!Number.isSafeInteger(observed) || observed < 0) {
      throw new AuditApiFailure("clock-invalid");
    }
    latestNow = Math.max(latestNow, observed);
    return latestNow;
  };
  let requestCount = 0;
  let retryCount = 0;

  const read = async (
    route: string,
    parameters: Record<string, unknown>,
    raw = false
  ): Promise<RequestResponse> => {
    if (boundedTransport === undefined) {
      throw new AuditApiFailure("response-boundary-unavailable");
    }
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const remainingMs = deadlineAt - monotonicNow();
      if (!Number.isSafeInteger(remainingMs) || remainingMs <= 0) {
        throw new AuditApiFailure("audit-deadline-exceeded");
      }
      if (requestCount >= MAX_API_REQUESTS) {
        throw new AuditApiFailure("request-budget-exceeded");
      }
      requestCount += 1;
      if (attempt > 0) {
        retryCount += 1;
      }
      try {
        let rawBytes: Uint8Array | undefined;
        const fetchImplementation: FetchImplementation = raw
          ? async (...arguments_) => {
              const boundedResponse = await boundedTransport(...arguments_);
              const bytes = new Uint8Array(await boundedResponse.arrayBuffer());
              rawBytes = bytes;
              return new Response(bytes, {
                headers: boundedResponse.headers,
                status: boundedResponse.status,
                statusText: boundedResponse.statusText
              });
            }
          : boundedTransport;
        const requestImplementation =
          raw && typeof rawRequest?.defaults === "function"
            ? rawRequest.defaults({ request: { fetch: fetchImplementation } })
            : request;
        const response = await requestImplementation(route, {
          ...parameters,
          request: {
            signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remainingMs)),
            fetch: fetchImplementation
          },
          headers: {
            accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
            "X-GitHub-Api-Version": API_VERSION
          }
        });
        if (deadlineAt - monotonicNow() <= 0) {
          throw new AuditApiFailure("audit-deadline-exceeded");
        }
        if (response.status === undefined) {
          throw new AuditApiFailure("response-status-invalid");
        }
        if (response.status === 304) {
          throw new AuditApiFailure("conditional-response-without-body");
        }
        if (
          !Number.isSafeInteger(response.status) ||
          response.status < 200 ||
          response.status >= 300
        ) {
          throw new AuditApiFailure("request-failed", response.status, response.headers);
        }
        if (response.status !== 200) {
          throw new AuditApiFailure("response-status-invalid", response.status);
        }
        validateResponseSize(response);
        if (raw && rawBytes === undefined) {
          throw new AuditApiFailure("raw-byte-capture-unavailable");
        }
        if (raw) {
          let decoded: string;
          try {
            decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(rawBytes);
          } catch {
            throw new AuditApiFailure("file-content-invalid");
          }
          return { ...response, data: decoded };
        }
        return response;
      } catch (error) {
        const delay = attempt < MAX_RETRIES ? retryDelay(error, monotonicNow()) : undefined;
        if (delay === undefined) {
          if (error instanceof AuditApiFailure) {
            throw error;
          }
          throw new AuditApiFailure("request-failed", errorStatus(error));
        }
        if (delay > deadlineAt - monotonicNow()) {
          throw new AuditApiFailure("audit-deadline-exceeded");
        }
        await sleep(delay);
      }
    }
    throw new AuditApiFailure("request-failed");
  };

  return {
    getRepository: async ({ owner, repo }): Promise<AuditRepositoryMetadata> => {
      const data = record((await read("GET /repos/{owner}/{repo}", { owner, repo })).data);
      const ownerRecord = record(data.owner);
      const responseOwner = stringField(ownerRecord.login);
      const responseOwnerType = ownerRecord.type;
      const responseName = stringField(data.name);
      if (
        responseOwner.toLowerCase() !== owner.toLowerCase() ||
        responseName.toLowerCase() !== repo.toLowerCase()
      ) {
        throw new AuditApiFailure("repository-identity-mismatch");
      }
      const ownerType =
        responseOwnerType === "Organization"
          ? "organization"
          : responseOwnerType === "User"
            ? "user"
            : undefined;
      if (ownerType === undefined) {
        throw new AuditApiFailure("repository-owner-type-invalid");
      }
      const visibility = data.visibility;
      if (visibility !== "public" && visibility !== "private" && visibility !== "internal") {
        throw new AuditApiFailure("repository-visibility-invalid");
      }
      return {
        owner: responseOwner,
        name: responseName,
        defaultBranch: stringField(data.default_branch),
        id: integerField(data.id, 1),
        ownerType,
        visibility
      };
    },
    getBranch: async ({ owner, repo, branch }) => {
      const data = record(
        (await read("GET /repos/{owner}/{repo}/branches/{branch}", { owner, repo, branch })).data
      );
      return { name: stringField(data.name), sha: shaField(record(data.commit).sha) };
    },
    getBranchProtection: async ({ owner, repo, branch }) => {
      try {
        const data = await read("GET /repos/{owner}/{repo}/branches/{branch}/protection", {
          owner,
          repo,
          branch
        });
        return mapBranchProtection(data.data, branch);
      } catch (error) {
        if (errorStatus(error) === 404) {
          return null;
        }
        throw error;
      }
    },
    listRulesets: async ({ owner, repo, ownerType }) => {
      const summaries = await collectPages(
        async (page) => {
          const response = await read("GET /repos/{owner}/{repo}/rulesets", {
            owner,
            repo,
            includes_parents: true,
            targets: "branch,tag,push,repository",
            per_page: PAGE_SIZE,
            page
          });
          if (!Array.isArray(response.data)) {
            throw new AuditApiFailure("rulesets-response-invalid");
          }
          return {
            items: response.data,
            headers: response.headers,
            pagination: {
              apiBaseUrl: configuredBaseUrl,
              pathname: `/repos/${owner}/${repo}/rulesets`,
              fixedQuery: {
                includes_parents: "true",
                targets: "branch,tag,push,repository",
                per_page: String(PAGE_SIZE)
              }
            }
          };
        },
        MAX_RULESETS,
        "rulesets"
      );
      const summaryIds = new Set<number>();
      for (const summary of summaries) {
        const id = integerField(record(summary).id, 1);
        if (summaryIds.has(id)) {
          throw new AuditApiFailure("rulesets-duplicate");
        }
        summaryIds.add(id);
      }
      const details = await mapWithConcurrency(summaries, 4, async (summary) => {
        const id = integerField(record(summary).id, 1);
        return mapRuleset(
          (
            await read("GET /repos/{owner}/{repo}/rulesets/{ruleset_id}", {
              owner,
              repo,
              ruleset_id: id
            })
          ).data,
          id,
          ownerType,
          owner,
          repo
        );
      });
      return details;
    },
    listWorkflowFiles: async ({ owner, repo, ref }) => {
      const response = await read("GET /repos/{owner}/{repo}/contents/.github/workflows", {
        owner,
        repo,
        ref
      });
      if (
        typeof response.headers !== "object" ||
        response.headers === null ||
        Array.isArray(response.headers)
      ) {
        throw new AuditApiFailure("response-header-invalid");
      }
      if (headerValue(response.headers, "link") !== undefined) {
        throw new AuditApiFailure("workflows-pagination-unsupported");
      }
      if (!Array.isArray(response.data)) {
        throw new AuditApiFailure("workflow-list-invalid");
      }
      if (response.data.length > MAX_AUDIT_WORKFLOW_SOURCES) {
        throw new AuditApiFailure("workflows-limit");
      }
      return response.data.flatMap((entry): AuditWorkflowFile[] => {
        const item = record(entry);
        const path = stringField(item.path);
        if (!/\.(?:yml|yaml)$/iu.test(path)) {
          return [];
        }
        const type = item.type;
        if (type !== "file" && type !== "symlink" && type !== "submodule" && type !== "dir") {
          throw new AuditApiFailure("workflow-entry-type-invalid");
        }
        return [{ path, type }];
      });
    },
    getFileAtRevision: async ({ owner, repo, path, ref }) => {
      const response = await read(
        "GET /repos/{owner}/{repo}/contents/{path}",
        { owner, repo, path, ref },
        true
      );
      if (
        typeof response.data !== "string" ||
        Buffer.byteLength(response.data, "utf8") > MAX_AUDIT_SOURCE_BYTES
      ) {
        throw new AuditApiFailure("file-content-invalid");
      }
      return response.data;
    },
    getTagProtection: async ({ owner, repo }): Promise<AuditTagProtection> => {
      try {
        const response = await read("GET /repos/{owner}/{repo}/tags/protection", { owner, repo });
        if (!Array.isArray(response.data)) {
          throw new AuditApiFailure("tag-protection-invalid");
        }
        if (response.data.length > MAX_NESTED_ITEMS) {
          throw new AuditApiFailure("tag-protection-limit");
        }
        const patterns = response.data.map((entry) => stringField(record(entry).pattern));
        const protectsAll = patterns.some(
          (pattern) => pattern === "*" || pattern === "~ALL" || pattern === "refs/tags/*"
        );
        return { known: true, allowsDeletion: !protectsAll, allowsUpdate: !protectsAll };
      } catch (error) {
        if (errorStatus(error) === 404) {
          return { known: false, allowsDeletion: true, allowsUpdate: true };
        }
        throw error;
      }
    },
    getRequestMetrics: () => ({ requestAttempts: requestCount, retryAttempts: retryCount })
  };
}
