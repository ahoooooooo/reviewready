import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOctokit } from "@actions/github";

import { createGitHubAuditClient } from "../src/github-audit-api.js";

vi.mock("@actions/github", () => ({ getOctokit: vi.fn() }));

const sha = "a".repeat(40);

function response(data: unknown, headers: Record<string, string> = {}) {
  const normalizedData =
    typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    "default_branch" in data &&
    !("owner" in data) &&
    !("name" in data)
      ? {
          ...(data as Record<string, unknown>),
          owner: { login: "octocat" },
          name: "demo",
          id: 123
        }
      : data;
  return { data: normalizedData, headers, status: 200 };
}

function octokitWithTransport(request: unknown): never {
  const callable = request as ((...arguments_: never[]) => unknown) & {
    readonly endpoint?: unknown;
    readonly defaults?: unknown;
  };
  Object.assign(callable, {
    endpoint: {
      DEFAULTS: { request: { fetch: () => Promise.resolve(new Response("", { status: 200 })) } }
    },
    defaults: () => request
  });
  return { request: callable } as never;
}

function fakeRequest() {
  return vi.fn((route: string, params: Record<string, unknown>) => {
    if (route === "GET /repos/{owner}/{repo}") {
      return Promise.resolve(response({ default_branch: "main" }));
    }
    if (route === "GET /repos/{owner}/{repo}/branches/{branch}") {
      return Promise.resolve(response({ name: "main", commit: { sha } }));
    }
    if (route === "GET /repos/{owner}/{repo}/branches/{branch}/protection") {
      return Promise.resolve(
        response({
          required_status_checks: {
            strict: true,
            contexts: ["ReviewReady"],
            checks: [{ context: "ReviewReady", app_id: 123 }]
          },
          enforce_admins: { enabled: true },
          required_pull_request_reviews: {
            required_approving_review_count: 1,
            bypass_pull_request_allowances: { users: [], teams: [], apps: [] }
          },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false }
        })
      );
    }
    if (route === "GET /repos/{owner}/{repo}/rulesets") {
      if (params.page === 2) {
        return Promise.resolve(response([]));
      }
      expect(params).toMatchObject({
        includes_parents: true,
        targets: "branch,tag,push,repository",
        page: 1
      });
      return Promise.resolve(
        response([
          {
            id: 7,
            name: "main",
            target: "branch",
            enforcement: "active"
          }
        ])
      );
    }
    if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
      return Promise.resolve(
        response({
          id: 7,
          name: "main",
          target: "branch",
          enforcement: "active",
          conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
          bypass_actors: [],
          rules: [
            { type: "non_fast_forward" },
            { type: "deletion" },
            {
              type: "required_status_checks",
              parameters: {
                required_status_checks: [{ context: "ReviewReady", integration_id: 123 }]
              }
            }
          ]
        })
      );
    }
    if (route === "GET /repos/{owner}/{repo}/contents/.github/workflows") {
      if (params.page === 2) {
        return Promise.resolve(response([]));
      }
      return Promise.resolve(
        response([
          { path: ".github/workflows/reviewready.yml", type: "file" },
          { path: ".github/workflows/README.md", type: "file" }
        ])
      );
    }
    if (route === "GET /repos/{owner}/{repo}/contents/{path}") {
      expect(params).toMatchObject({ ref: sha });
      return Promise.resolve(response("on: pull_request\njobs: {}"));
    }
    if (route === "GET /repos/{owner}/{repo}/tags/protection") {
      return Promise.resolve(response([{ pattern: "v*" }]));
    }
    throw new Error(`unexpected route ${route}`);
  });
}

describe("GitHub repository audit API adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("binds repository identity to the API response", async () => {
    const request = vi.fn(() =>
      Promise.resolve(
        response({
          owner: { login: "attacker" },
          name: "demo",
          default_branch: "main"
        })
      )
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "repository-identity-mismatch"
    );
  });

  it("maps read-only GitHub responses into the collector contract", async () => {
    const request = fakeRequest();
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).resolves.toEqual({
      owner: "octocat",
      name: "demo",
      defaultBranch: "main",
      id: 123
    });
    await expect(
      client.getBranch({ owner: "octocat", repo: "demo", branch: "main" })
    ).resolves.toEqual({
      name: "main",
      sha
    });
    await expect(
      client.getBranchProtection({ owner: "octocat", repo: "demo", branch: "main" })
    ).resolves.toMatchObject({
      requiredStatusChecks: {
        strict: true,
        checks: [{ name: "ReviewReady", appId: 123 }]
      }
    });
    await expect(client.listRulesets({ owner: "octocat", repo: "demo" })).resolves.toEqual([
      expect.objectContaining({
        id: 7,
        refPatterns: ["~DEFAULT_BRANCH"],
        allowForcePushes: false,
        allowDeletions: false,
        requiredChecks: [{ name: "ReviewReady", appId: 123 }],
        bypassActors: []
      })
    ]);
    await expect(
      client.listWorkflowFiles({ owner: "octocat", repo: "demo", ref: sha })
    ).resolves.toEqual([{ path: ".github/workflows/reviewready.yml", type: "file" }]);
    await expect(
      client.getFileAtRevision({
        owner: "octocat",
        repo: "demo",
        path: ".reviewready.yml",
        ref: sha
      })
    ).resolves.toContain("pull_request");
    await expect(
      client.getTagProtection({ owner: "octocat", repo: "demo" })
    ).resolves.toMatchObject({
      known: true
    });
  });

  it("maps push rulesets that have no ref-name condition", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        if (params.page === 2) {
          return Promise.resolve(response([]));
        }
        return Promise.resolve(response([{ id: 8 }]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 8,
            name: "push-guard",
            target: "push",
            enforcement: "active",
            conditions: {},
            bypass_actors: [],
            rules: [{ type: "file_extension_restriction" }]
          })
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.listRulesets({ owner: "octocat", repo: "demo" })).resolves.toMatchObject([
      {
        id: 8,
        target: "push",
        refPatterns: [],
        allowForcePushes: undefined,
        allowDeletions: undefined
      }
    ]);
  });

  it("retries one bounded transient read and does not retry permanent errors", async () => {
    const request = fakeRequest();
    request.mockRejectedValueOnce(Object.assign(new Error("busy"), { status: 503 }));
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const sleep = vi.fn(() => Promise.resolve());
    const client = createGitHubAuditClient("secret", { sleep });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).resolves.toMatchObject({
      defaultBranch: "main"
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("rejects non-success responses even when a response body looks valid", async () => {
    const request = vi.fn(() =>
      Promise.resolve({ data: { default_branch: "main" }, headers: {}, status: 500 })
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "request-failed"
    );
  });

  it("rejects successful responses with a non-canonical status", async () => {
    for (const status of [202, 203, 206]) {
      const request = vi.fn(() =>
        Promise.resolve({
          data: { default_branch: "main" },
          headers: {},
          status
        })
      );
      vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
      const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

      await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
        "response-status-invalid"
      );
    }
  });

  it("rejects a response without an explicit HTTP status", async () => {
    const request = vi.fn(() => Promise.resolve({ data: { default_branch: "main" }, headers: {} }));
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "response-status-invalid"
    );
  });

  it("follows bounded workflow-directory pagination", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route !== "GET /repos/{owner}/{repo}/contents/.github/workflows") {
        return Promise.reject(new Error("unexpected route"));
      }
      if (params.page === undefined || params.page === 1) {
        return Promise.resolve(
          response([{ path: ".github/workflows/one.yml", type: "file" }], {
            link: '<https://api.github.com/repos/octocat/demo/contents/.github/workflows?page=2>; rel="next"'
          })
        );
      }
      if (params.page === 2) {
        return Promise.resolve(response([{ path: ".github/workflows/two.yml", type: "file" }]));
      }
      return Promise.resolve(response([]));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(
      client.listWorkflowFiles({ owner: "octocat", repo: "demo", ref: sha })
    ).resolves.toEqual([
      { path: ".github/workflows/one.yml", type: "file" },
      { path: ".github/workflows/two.yml", type: "file" }
    ]);
    expect(request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/contents/.github/workflows",
      expect.objectContaining({ page: 1, per_page: 100, ref: sha })
    );
  });

  it("fails closed when a short unlinked workflow directory page repeats", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      void params;
      if (route !== "GET /repos/{owner}/{repo}/contents/.github/workflows") {
        return Promise.reject(new Error("unexpected route"));
      }
      return Promise.resolve(
        response([
          { path: ".github/workflows/one.yml", type: "file" },
          { path: ".github/workflows/two.yml", type: "file" }
        ])
      );
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(
      client.listWorkflowFiles({ owner: "octocat", repo: "demo", ref: sha })
    ).rejects.toThrow("workflows-pagination-ambiguous");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a short unlinked workflow page is followed by distinct data", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route !== "GET /repos/{owner}/{repo}/contents/.github/workflows") {
        return Promise.reject(new Error("unexpected route"));
      }
      return Promise.resolve(
        response(
          params.page === 1
            ? [{ path: ".github/workflows/one.yml", type: "file" }]
            : [{ path: ".github/workflows/two.yml", type: "file" }]
        )
      );
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(
      client.listWorkflowFiles({ owner: "octocat", repo: "demo", ref: sha })
    ).rejects.toThrow("workflows-pagination-ambiguous");
  });

  it("rejects a ruleset detail whose identity changes from the listed summary", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(params.page === 1 ? response([{ id: 7 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 8,
            name: "wrong",
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
            bypass_actors: [],
            rules: []
          })
        );
      }
      return Promise.reject(new Error("unexpected route"));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.listRulesets({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "ruleset-id-mismatch"
    );
  });

  it("normalizes only a confirmed protection 404 as absent", async () => {
    const request = fakeRequest();
    request.mockImplementation((route, params) => {
      void params;
      if (route === "GET /repos/{owner}/{repo}/branches/{branch}/protection") {
        return Promise.reject(Object.assign(new Error("missing"), { status: 404 }));
      }
      return Promise.resolve(response({ default_branch: "main" }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(
      client.getBranchProtection({ owner: "octocat", repo: "demo", branch: "main" })
    ).resolves.toBeNull();
  });

  it("normalizes a confirmed tag-protection 404 as unknown", async () => {
    const request = vi.fn((route: string) => {
      if (route === "GET /repos/{owner}/{repo}/tags/protection") {
        return Promise.reject(Object.assign(new Error("unavailable"), { status: 404 }));
      }
      return Promise.resolve(response({ default_branch: "main" }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getTagProtection({ owner: "octocat", repo: "demo" })).resolves.toEqual({
      known: false,
      allowsDeletion: true,
      allowsUpdate: true
    });
  });

  it("rejects an oversized response before mapping untrusted API data", async () => {
    const request = vi.fn(() =>
      Promise.resolve(
        response({ default_branch: "main" }, { "content-length": String(3 * 1024 * 1024) })
      )
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "response-size-limit"
    );
  });

  it("keeps raw workflow and policy source within the analyzer limit", async () => {
    const request = vi.fn(() => Promise.resolve(response("x".repeat(256 * 1024 + 1))));
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(
      client.getFileAtRevision({
        owner: "octocat",
        repo: "demo",
        path: ".github/workflows/reviewready.yml",
        ref: sha
      })
    ).rejects.toThrow("file-content-invalid");
  });

  it("fails closed when a bounded raw transport cannot be installed", async () => {
    const request = vi.fn(() => Promise.resolve(response("")));
    vi.mocked(getOctokit).mockReturnValue({ request } as never);
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", undefined);
    try {
      const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });
      await expect(
        client.getFileAtRevision({
          owner: "octocat",
          repo: "demo",
          path: ".github/workflows/reviewready.yml",
          ref: sha
        })
      ).rejects.toThrow("response-boundary-unavailable");
      expect(request).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("fails closed for structured responses when the bounded transport is unavailable", async () => {
    const request = vi.fn(() => Promise.resolve(response({ default_branch: "main" })));
    vi.mocked(getOctokit).mockReturnValue({ request } as never);
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", undefined);
    try {
      const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });
      await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
        "response-boundary-unavailable"
      );
      expect(request).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("passes the bounded fetch per request when Octokit defaults ignores it", async () => {
    const oversized = "x".repeat(2 * 1024 * 1024 + 1);
    const baseFetch = vi.fn(() => Promise.resolve(new Response(oversized, { status: 200 })));
    const request = vi.fn(async (_route: string, parameters: Record<string, unknown>) => {
      const requestOptions = parameters.request as { readonly fetch?: typeof globalThis.fetch };
      const fetchImplementation = requestOptions.fetch;
      if (typeof fetchImplementation !== "function") {
        throw new Error("bounded fetch was not passed to the request");
      }
      const boundedResponse = await fetchImplementation("https://api.github.com");
      if (boundedResponse.status >= 400) {
        throw Object.assign(new Error("response failed"), { status: boundedResponse.status });
      }
      return { data: await boundedResponse.text(), headers: {}, status: boundedResponse.status };
    });
    const rawRequest = Object.assign(request, {
      endpoint: { DEFAULTS: { request: { fetch: baseFetch } } },
      defaults: () => request
    });
    vi.mocked(getOctokit).mockReturnValue({ request: rawRequest } as never);

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getFileAtRevision({
        owner: "octocat",
        repo: "demo",
        path: ".reviewready.yml",
        ref: sha
      })
    ).rejects.toThrow("request-failed");
    const calledParameters = request.mock.calls[0]?.[1];
    const calledRequest = calledParameters?.request;
    if (typeof calledRequest !== "object" || calledRequest === null) {
      throw new Error("request options were not passed");
    }
    expect(typeof (calledRequest as { readonly fetch?: unknown }).fetch).toBe("function");
  });

  it("uses global fetch when Octokit does not expose a default fetch", async () => {
    const oversized = "x".repeat(2 * 1024 * 1024 + 1);
    const baseFetch = vi.fn(() => Promise.resolve(new Response(oversized, { status: 200 })));
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", baseFetch);
    try {
      const request = vi.fn(async (_route: string, parameters: Record<string, unknown>) => {
        const requestOptions = parameters.request as { readonly fetch?: typeof globalThis.fetch };
        const fetchImplementation = requestOptions.fetch;
        if (typeof fetchImplementation !== "function") {
          throw new Error("bounded fetch was not passed to the request");
        }
        const boundedResponse = await fetchImplementation("https://api.github.com");
        if (boundedResponse.status >= 400) {
          throw Object.assign(new Error("response failed"), { status: boundedResponse.status });
        }
        return { data: await boundedResponse.text(), headers: {}, status: boundedResponse.status };
      });
      const rawRequest = Object.assign(request, {
        endpoint: { DEFAULTS: { request: { signal: undefined } } },
        defaults: () => request
      });
      vi.mocked(getOctokit).mockReturnValue({ request: rawRequest } as never);

      await expect(
        createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getFileAtRevision({
          owner: "octocat",
          repo: "demo",
          path: ".reviewready.yml",
          ref: sha
        })
      ).rejects.toThrow("request-failed");
      expect(baseFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("does not accept a parser-swallowed oversized raw response", async () => {
    const oversized = '{"default_branch":"main"}' + " ".repeat(2 * 1024 * 1024);
    let boundedFetch: ((input: string) => Promise<Response>) | undefined;
    const parserRequest = vi.fn(async () => {
      if (boundedFetch === undefined) {
        throw new Error("bounded fetch was not installed");
      }
      const parsedResponse = await boundedFetch("https://api.github.com");
      const data = await parsedResponse.text().catch(() => "");
      if (parsedResponse.status >= 400) {
        throw Object.assign(new Error("response failed"), { status: parsedResponse.status });
      }
      return { data, headers: {}, status: parsedResponse.status };
    });
    const rawRequest = Object.assign(parserRequest, {
      endpoint: {
        DEFAULTS: {
          request: {
            fetch: () =>
              Promise.resolve(
                new Response(oversized, {
                  status: 200,
                  headers: { "content-type": "application/json" }
                })
              )
          }
        }
      },
      defaults: (options: Record<string, unknown>) => {
        const requestOptions = options.request as {
          readonly fetch?: (input: string) => Promise<Response>;
        };
        boundedFetch = requestOptions.fetch;
        return parserRequest;
      }
    });
    vi.mocked(getOctokit).mockReturnValue({ request: rawRequest } as never);
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(
      client.getFileAtRevision({
        owner: "octocat",
        repo: "demo",
        path: ".github/workflows/reviewready.yml",
        ref: sha
      })
    ).rejects.toThrow("request-failed");
  });

  it("cancels a response stream when the declared body is oversized", async () => {
    let cancel: (() => Promise<void>) | undefined;
    let boundedFetch: ((input: string) => Promise<Response>) | undefined;
    const parserRequest = vi.fn(async () => {
      if (boundedFetch === undefined) {
        throw new Error("bounded fetch was not installed");
      }
      const parsedResponse = await boundedFetch("https://api.github.com");
      await parsedResponse.text();
      return { data: "", headers: {}, status: parsedResponse.status };
    });
    const rawRequest = Object.assign(parserRequest, {
      endpoint: {
        DEFAULTS: {
          request: {
            fetch: () =>
              Promise.resolve(
                new Response(
                  new ReadableStream<Uint8Array>({
                    start(controller) {
                      controller.enqueue(new Uint8Array([1]));
                    },
                    cancel() {
                      cancel = () => Promise.resolve();
                    }
                  }),
                  {
                    status: 200,
                    headers: { "content-length": String(3 * 1024 * 1024) }
                  }
                )
              )
          }
        }
      },
      defaults: (options: Record<string, unknown>) => {
        const requestOptions = options.request as {
          readonly fetch?: (input: string) => Promise<Response>;
        };
        boundedFetch = requestOptions.fetch;
        return parserRequest;
      }
    });
    vi.mocked(getOctokit).mockReturnValue({ request: rawRequest } as never);
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow();
    expect(cancel).toBeTypeOf("function");
  });

  it("supports the maximum collection with bounded transient retries", async () => {
    const ruleSummaries = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
    const workflowEntries = Array.from({ length: 100 }, (_, index) => ({
      path: ".github/workflows/workflow-" + String(index) + ".yml",
      type: "file"
    }));
    let transientFailures = 46;
    const failedRequests = new Set<string>();
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      const requestKey = route + JSON.stringify(params);
      if (transientFailures > 0 && !failedRequests.has(requestKey)) {
        transientFailures -= 1;
        failedRequests.add(requestKey);
        return Promise.reject(Object.assign(new Error("busy"), { status: 503 }));
      }
      if (route === "GET /repos/{owner}/{repo}") {
        return Promise.resolve(response({ default_branch: "main" }));
      }
      if (route === "GET /repos/{owner}/{repo}/branches/{branch}") {
        return Promise.resolve(response({ name: "main", commit: { sha } }));
      }
      if (route === "GET /repos/{owner}/{repo}/branches/{branch}/protection") {
        return Promise.resolve(
          response({
            required_status_checks: null,
            enforce_admins: { enabled: true },
            required_pull_request_reviews: null,
            allow_force_pushes: { enabled: false },
            allow_deletions: { enabled: false }
          })
        );
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(response(params.page === 1 ? ruleSummaries : []));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        const id = params.ruleset_id;
        return Promise.resolve(
          response({
            id,
            name: "ruleset-" + String(id),
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
            bypass_actors: [],
            rules: []
          })
        );
      }
      if (route === "GET /repos/{owner}/{repo}/contents/.github/workflows") {
        return Promise.resolve(response(params.page === 1 ? workflowEntries : []));
      }
      if (route === "GET /repos/{owner}/{repo}/contents/{path}") {
        return Promise.resolve(response("on: pull_request\\njobs: {}"));
      }
      if (route === "GET /repos/{owner}/{repo}/tags/protection") {
        return Promise.resolve(response([{ pattern: "*" }]));
      }
      throw new Error("unexpected route");
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", {
      sleep: () => Promise.resolve()
    });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).resolves.toBeDefined();
    await expect(
      client.getBranch({ owner: "octocat", repo: "demo", branch: "main" })
    ).resolves.toBeDefined();
    await expect(
      client.getBranchProtection({ owner: "octocat", repo: "demo", branch: "main" })
    ).resolves.toBeDefined();
    await expect(client.listRulesets({ owner: "octocat", repo: "demo" })).resolves.toHaveLength(
      100
    );
    await expect(
      client.listWorkflowFiles({ owner: "octocat", repo: "demo", ref: sha })
    ).resolves.toHaveLength(100);
    for (const path of workflowEntries.map((entry) => entry.path)) {
      await expect(
        client.getFileAtRevision({ owner: "octocat", repo: "demo", path, ref: sha })
      ).resolves.toContain("pull_request");
    }
    await expect(
      client.getFileAtRevision({
        owner: "octocat",
        repo: "demo",
        path: ".reviewready.yml",
        ref: sha
      })
    ).resolves.toContain("pull_request");
    await expect(
      client.getTagProtection({ owner: "octocat", repo: "demo" })
    ).resolves.toBeDefined();
    expect(transientFailures).toBe(0);
  });

  it("does not start a retry after the overall collection deadline", async () => {
    let currentTime = 0;
    const request = vi.fn(() => Promise.reject(Object.assign(new Error("busy"), { status: 503 })));
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const sleep = vi.fn(() => {
      currentTime = 2_000;
      return Promise.resolve();
    });
    const client = createGitHubAuditClient("secret", {
      sleep,
      now: () => currentTime,
      deadlineMs: 1_000
    });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "audit-deadline-exceeded"
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not extend a deadline when the clock moves backward", async () => {
    const observations = [0, 0, 1_500, 100, 100];
    const request = vi.fn(() => Promise.reject(Object.assign(new Error("busy"), { status: 503 })));
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", {
        now: () => observations.shift() ?? -1_000,
        sleep: () => Promise.resolve(),
        deadlineMs: 1_000
      }).getRepository({ owner: "octocat", repo: "demo" })
    ).rejects.toThrow("audit-deadline-exceeded");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects a response that arrives after the overall deadline", async () => {
    let currentTime = 0;
    const request = vi.fn(() => {
      currentTime = 1_500;
      return response({ default_branch: "main" });
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", {
        now: () => currentTime,
        sleep: () => Promise.resolve(),
        deadlineMs: 1_000
      }).getRepository({ owner: "octocat", repo: "demo" })
    ).rejects.toThrow("audit-deadline-exceeded");
  });

  it("marks missing branch-review bypass data as unknown", async () => {
    const request = vi.fn((route: string) => {
      if (route === "GET /repos/{owner}/{repo}/branches/{branch}/protection") {
        return Promise.resolve(
          response({
            required_status_checks: null,
            enforce_admins: { enabled: true },
            required_pull_request_reviews: { required_approving_review_count: 1 },
            allow_force_pushes: { enabled: false },
            allow_deletions: { enabled: false }
          })
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(
      client.getBranchProtection({ owner: "octocat", repo: "demo", branch: "main" })
    ).resolves.toMatchObject({
      requiredPullRequestReviews: { bypassActors: [], bypassActorsKnown: false }
    });
  });

  it("fails closed when branch-review bypass arrays are incomplete", async () => {
    const request = vi.fn((route: string) => {
      if (route === "GET /repos/{owner}/{repo}/branches/{branch}/protection") {
        return Promise.resolve(
          response({
            required_status_checks: null,
            enforce_admins: { enabled: true },
            required_pull_request_reviews: {
              required_approving_review_count: 1,
              bypass_pull_request_allowances: { users: [], teams: [] }
            },
            allow_force_pushes: { enabled: false },
            allow_deletions: { enabled: false }
          })
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(
      client.getBranchProtection({ owner: "octocat", repo: "demo", branch: "main" })
    ).resolves.toMatchObject({
      requiredPullRequestReviews: { bypassActors: [], bypassActorsKnown: false }
    });
  });

  it("rejects a next link containing duplicate page parameters", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        if (params.page === 1) {
          return Promise.resolve(
            response([{ id: 7, name: "main" }], {
              link: '<https://api.github.com/repos/octocat/demo/rulesets?page=2&page=999>; rel="next"'
            })
          );
        }
        return Promise.resolve(response([]));
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.listRulesets({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "pagination-link-invalid"
    );
  });

  it("preserves an organization ruleset repository scope", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        if (params.page === 2) {
          return Promise.resolve(response([]));
        }
        return Promise.resolve(response([{ id: 9 }]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 9,
            name: "organization-main",
            target: "branch",
            enforcement: "active",
            conditions: {
              ref_name: { include: ["~DEFAULT_BRANCH"] },
              repository_name: { include: ["other-owner/other-repository"] }
            },
            bypass_actors: [],
            rules: []
          })
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.listRulesets({ owner: "octocat", repo: "demo" })).resolves.toMatchObject([
      { repositoryPatterns: ["other-owner/other-repository"] }
    ]);
  });

  it("collects repository-target rulesets", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        if (params.page === 1) {
          expect(params).toMatchObject({
            includes_parents: true,
            targets: "branch,tag,push,repository",
            page: 1
          });
        }
        return Promise.resolve(params.page === 1 ? response([{ id: 10 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 10,
            name: "repository-policy",
            target: "repository",
            enforcement: "active",
            conditions: { repository_name: { include: ["~ALL"] } },
            bypass_actors: [],
            rules: []
          })
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.listRulesets({ owner: "octocat", repo: "demo" })).resolves.toMatchObject([
      {
        id: 10,
        target: "repository",
        repositoryPatterns: ["~ALL"]
      }
    ]);
  });

  it("rejects an unscoped repository-target ruleset", async () => {
    const request = vi.fn((route: string, parameters: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(parameters.page === 1 ? response([{ id: 13 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 13,
            name: "repository-policy",
            target: "repository",
            enforcement: "active",
            conditions: {},
            bypass_actors: [],
            rules: []
          })
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("ruleset-scope-unsupported");
  });

  it("rejects unsupported conditions on repository-target rulesets", async () => {
    const unsupportedConditions: readonly Record<string, unknown>[] = [
      { ref_name: { include: ["~ALL"] } },
      { unknown_condition: { include: ["~ALL"] } },
      { repository_name: { include: ["~ALL"], protected: true } }
    ];
    for (const conditions of unsupportedConditions) {
      const request = vi.fn((route: string, parameters: Record<string, unknown>) => {
        if (route === "GET /repos/{owner}/{repo}/rulesets") {
          return Promise.resolve(parameters.page === 1 ? response([{ id: 11 }]) : response([]));
        }
        if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
          return Promise.resolve(
            response({
              id: 11,
              name: "repository-policy",
              target: "repository",
              enforcement: "active",
              conditions,
              bypass_actors: [],
              rules: []
            })
          );
        }
        return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
      });
      vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

      await expect(
        createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
          owner: "octocat",
          repo: "demo"
        })
      ).rejects.toThrow("ruleset-scope-unsupported");
    }
  });

  it("rejects evaluate enforcement on repository-target rulesets", async () => {
    const request = vi.fn((route: string, parameters: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(parameters.page === 1 ? response([{ id: 12 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 12,
            name: "repository-policy",
            target: "repository",
            enforcement: "evaluate",
            conditions: { repository_name: { include: ["~ALL"] } },
            bypass_actors: [],
            rules: []
          })
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("ruleset-enforcement-invalid");
  });

  it("rejects noncanonical ruleset enforcement states", async () => {
    const request = vi.fn((route: string, parameters: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(parameters.page === 1 ? response([{ id: 14 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 14,
            name: "main",
            target: "branch",
            enforcement: "enabled",
            conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
            bypass_actors: [],
            rules: []
          })
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("ruleset-enforcement-invalid");
  });

  it("rejects ruleset scopes that the normalized contract cannot evaluate", async () => {
    const unsupportedConditions: readonly Record<string, unknown>[] = [
      {
        ref_name: {
          include: ["~DEFAULT_BRANCH"],
          exclude: ["refs/heads/main"]
        }
      },
      {
        ref_name: { include: ["~DEFAULT_BRANCH"] },
        repository_name: {
          include: ["octocat/demo"],
          exclude: ["octocat/demo"]
        }
      },
      {
        ref_name: { include: ["~DEFAULT_BRANCH"], protected: true }
      },
      {
        ref_name: { include: ["~DEFAULT_BRANCH"] },
        repository_id: { include: [999] }
      }
    ];

    for (const conditions of unsupportedConditions) {
      const request = vi.fn((route: string, params: Record<string, unknown>) => {
        if (route === "GET /repos/{owner}/{repo}/rulesets") {
          if (params.page === 2) {
            return Promise.resolve(response([]));
          }
          return Promise.resolve(response([{ id: 9 }]));
        }
        if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
          return Promise.resolve(
            response({
              id: 9,
              name: "scoped",
              target: "branch",
              enforcement: "active",
              conditions,
              bypass_actors: [],
              rules: []
            })
          );
        }
        return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
      });
      vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

      await expect(
        createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
          owner: "octocat",
          repo: "demo"
        })
      ).rejects.toThrow("ruleset-scope-unsupported");
    }
  });

  it("keeps the bounded ruleset maximum within the request budget", async () => {
    const summaries = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return params.page === 1
          ? Promise.resolve(response(summaries))
          : Promise.resolve(response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        const id = params.ruleset_id;
        return Promise.resolve(
          response({
            id,
            name: "ruleset-" + String(id),
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
            bypass_actors: [],
            rules: []
          })
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).resolves.toHaveLength(100);
    expect(request).toHaveBeenCalledTimes(102);
  });

  it("rejects invalid client configuration and malformed repository responses", async () => {
    expect(() => createGitHubAuditClient("", { sleep: () => Promise.resolve() })).toThrow(
      "token-invalid"
    );
    expect(() =>
      createGitHubAuditClient("secret", { deadlineMs: 0, sleep: () => Promise.resolve() })
    ).toThrow("deadline-invalid");
    expect(() =>
      createGitHubAuditClient("secret", {
        deadlineMs: 120_001,
        sleep: () => Promise.resolve()
      })
    ).toThrow("deadline-invalid");
    expect(() =>
      createGitHubAuditClient("secret", {
        now: () => -1,
        sleep: () => Promise.resolve()
      })
    ).toThrow("clock-invalid");
    expect(() =>
      createGitHubAuditClient("secret", {
        now: () => Number.MAX_SAFE_INTEGER,
        deadlineMs: 1,
        sleep: () => Promise.resolve()
      })
    ).toThrow("clock-invalid");

    for (const data of [null, [], { default_branch: "" }]) {
      const request = vi.fn(() => Promise.resolve(response(data)));
      vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
      const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });
      await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
        data === null || Array.isArray(data) ? "response-object-invalid" : "response-string-invalid"
      );
    }

    const unsafeText = vi.fn(() => Promise.resolve(response({ default_branch: "main\u0007" })));
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(unsafeText));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-string-invalid");

    const invalidBranch = vi.fn(() =>
      Promise.resolve(response({ name: "main", commit: { sha: "not-a-sha" } }))
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(invalidBranch));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getBranch({
        owner: "octocat",
        repo: "demo",
        branch: "main"
      })
    ).rejects.toThrow("response-sha-invalid");
  });

  it("bounds response headers, serialization, conditional responses, and request failures", async () => {
    for (const headers of [
      { "content-length": "not-a-number" },
      { "Content-Length": "1", "content-length": "1" },
      { "content-length": String(3 * 1024 * 1024) }
    ]) {
      const request = vi.fn(() => Promise.resolve(response({ default_branch: "main" }, headers)));
      vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
      await expect(
        createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
          owner: "octocat",
          repo: "demo"
        })
      ).rejects.toThrow(
        headers["content-length"] === String(3 * 1024 * 1024)
          ? "response-size-limit"
          : "response-header-invalid"
      );
    }

    const huge = vi.fn(() => Promise.resolve(response("a".repeat(2 * 1024 * 1024 + 1))));
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(huge));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-size-limit");

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const circularRequest = vi.fn(() => Promise.resolve(response(circular)));
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(circularRequest));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-data-invalid");

    const conditional = vi.fn(() => Promise.resolve({ data: {}, headers: {}, status: 304 }));
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(conditional));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("conditional-response-without-body");

    const permanent = vi.fn(() =>
      Promise.reject(Object.assign(new Error("denied"), { status: 400 }))
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(permanent));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("request-failed");
  });

  it("bounds raw response bytes before JSON parsing", async () => {
    let capturedFetch: ((input: string) => Promise<Response>) | undefined;
    const request = vi.fn(() => Promise.resolve(response({ default_branch: "main" })));
    const baseFetch = vi.fn(() =>
      Promise.resolve(
        new Response('{"default_branch":"main"}' + " ".repeat(2 * 1024 * 1024), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );
    const defaults = vi.fn((received: Record<string, unknown>) => {
      const requestOptions = received.request as {
        readonly fetch?: (input: string) => Promise<Response>;
      };
      capturedFetch = requestOptions.fetch;
      return request;
    });
    const octokitRequest = Object.assign(request, {
      endpoint: { DEFAULTS: { request: { fetch: baseFetch } } },
      defaults
    });
    vi.mocked(getOctokit).mockReturnValue({ request: octokitRequest } as never);
    createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    expect(capturedFetch).toBeTypeOf("function");
    if (capturedFetch === undefined) {
      throw new Error("bounded fetch is not configured");
    }
    const boundedResponse = await capturedFetch("https://api.github.com");
    expect(boundedResponse.status).toBe(413);
    await expect(boundedResponse.text()).resolves.toBe("");
  });

  it("covers bounded transport normal, null, malformed, and cleanup paths", async () => {
    let boundedFetch: ((input: string) => Promise<Response>) | undefined;
    const install = (baseFetch: () => Promise<Response>): void => {
      const request = vi.fn(() => Promise.resolve(response({ default_branch: "main" })));
      const rawRequest = Object.assign(request, {
        endpoint: { DEFAULTS: { request: { fetch: baseFetch } } },
        defaults: (options: Record<string, unknown>) => {
          const requestOptions = options.request as {
            readonly fetch?: (input: string) => Promise<Response>;
          };
          boundedFetch = requestOptions.fetch;
          return request;
        }
      });
      vi.mocked(getOctokit).mockReturnValue({ request: rawRequest } as never);
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });
      if (boundedFetch === undefined) {
        throw new Error("bounded fetch is not configured");
      }
    };

    install(() => Promise.resolve(new Response("ok", { status: 200 })));
    await expect(
      boundedFetch?.("https://api.github.com").then((item) => item.text())
    ).resolves.toBe("ok");

    install(() =>
      Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { "content-length": String(3 * 1024 * 1024) }
        })
      )
    );
    await expect(boundedFetch?.("https://api.github.com")).resolves.toMatchObject({ status: 413 });

    let canceled = false;
    install(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
            },
            cancel() {
              canceled = true;
            }
          }),
          { status: 200, headers: { "content-length": "not-a-number" } }
        )
      )
    );
    await expect(boundedFetch?.("https://api.github.com")).resolves.toMatchObject({ status: 502 });
    expect(canceled).toBe(true);

    install(() =>
      Promise.resolve({
        status: 200,
        statusText: "",
        headers: new Headers(),
        body: {
          getReader: () => ({
            read: () => Promise.resolve({ done: false, value: "bad" }),
            cancel: () => Promise.resolve()
          })
        }
      } as unknown as Response)
    );
    await expect(boundedFetch?.("https://api.github.com")).resolves.toMatchObject({ status: 502 });

    install(() =>
      Promise.resolve({
        status: 200,
        statusText: "",
        headers: new Headers(),
        body: {
          getReader: () => ({
            read: () => Promise.reject(new Error("stream broke")),
            cancel: () => Promise.resolve()
          })
        }
      } as unknown as Response)
    );
    await expect(boundedFetch?.("https://api.github.com")).rejects.toThrow("stream broke");

    let cancelFailure = false;
    install(() =>
      Promise.resolve({
        status: 200,
        statusText: "",
        headers: new Headers({ "content-length": String(3 * 1024 * 1024) }),
        body: {
          getReader: () => ({
            read: () => Promise.resolve({ done: true }),
            cancel: () => {
              cancelFailure = true;
              return Promise.reject(new Error("cancel broke"));
            }
          })
        }
      } as unknown as Response)
    );
    await expect(boundedFetch?.("https://api.github.com")).resolves.toMatchObject({ status: 413 });
    expect(cancelFailure).toBe(true);
  });

  it("bounds untrusted pagination and retry header values", async () => {
    const request = vi.fn((route: string) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(response([{ id: 1 }], { link: "x".repeat(64 * 1024 + 1) }));
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-header-limit");
  });

  it("uses only bounded retry delays from retry-after and rate-limit headers", async () => {
    const retryAfterRequest = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("busy"), {
          status: 429,
          response: { headers: { "retry-after": "0.5" } }
        })
      )
      .mockResolvedValue(response({ default_branch: "main" }));
    const retryAfterSleep = vi.fn(() => Promise.resolve());
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(retryAfterRequest));
    await expect(
      createGitHubAuditClient("secret", { sleep: retryAfterSleep }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).resolves.toMatchObject({ defaultBranch: "main" });
    expect(retryAfterSleep).toHaveBeenCalledWith(500);

    const rateLimitRequest = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("rate limited"), {
          status: 403,
          response: { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2" } }
        })
      )
      .mockResolvedValue(response({ default_branch: "main" }));
    const rateLimitSleep = vi.fn(() => Promise.resolve());
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(rateLimitRequest));
    await expect(
      createGitHubAuditClient("secret", {
        sleep: rateLimitSleep,
        now: () => 1_000
      }).getRepository({ owner: "octocat", repo: "demo" })
    ).resolves.toMatchObject({ defaultBranch: "main" });
    expect(rateLimitSleep).toHaveBeenCalledWith(1_000);

    const invalidRetryAfter = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("busy"), {
          status: 503,
          response: { headers: {} }
        })
      )
      .mockResolvedValue(response({ default_branch: "main" }));
    const invalidRetrySleep = vi.fn(() => Promise.resolve());
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(invalidRetryAfter));
    await expect(
      createGitHubAuditClient("secret", { sleep: invalidRetrySleep }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).resolves.toMatchObject({ defaultBranch: "main" });
    expect(invalidRetrySleep).toHaveBeenCalledWith(100);
  });

  it("rejects malformed retry headers and malformed pagination links", async () => {
    const invalidRetryAfter = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("busy"), {
          status: 503,
          response: { headers: { "retry-after": "not-a-number" } }
        })
      )
      .mockResolvedValue(response({ default_branch: "main" }));
    const retrySleep = vi.fn(() => Promise.resolve());
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(invalidRetryAfter));
    await expect(
      createGitHubAuditClient("secret", { sleep: retrySleep }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("request-failed");
    expect(retrySleep).not.toHaveBeenCalled();

    const invalidReset = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error("rate limited"), {
          status: 403,
          response: { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "bad" } }
        })
      )
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(invalidReset));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("request-failed");

    const malformedLinks = [
      'rel="next"',
      '<not a url>; rel="next"',
      '<https://api.github.com/repos/octocat/demo/rulesets?page=bad>; rel="next"'
    ];
    for (const link of malformedLinks) {
      const request = vi.fn(() => Promise.resolve(response([{ id: 1 }], { link })));
      vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
      await expect(
        createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
          owner: "octocat",
          repo: "demo"
        })
      ).rejects.toThrow("pagination-link-invalid");
    }

    const unrelatedLink = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(
          response(params.page === 1 ? [{ id: 1 }] : [], {
            link: params.page === 1 ? '<https://api.github.com/next>; rel="other"' : ""
          })
        );
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 1,
            name: "main",
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~ALL"] } },
            rules: [],
            bypass_actors: []
          })
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(unrelatedLink));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).resolves.toHaveLength(1);
  });

  it("maps structured branch protection checks, review bypass actors, and null rules", async () => {
    const request = vi.fn((route: string) => {
      if (route === "GET /repos/{owner}/{repo}/branches/{branch}/protection") {
        return Promise.resolve(
          response({
            required_status_checks: {
              strict: false,
              checks: [],
              contexts: ["legacy-context"]
            },
            enforce_admins: { enabled: false },
            required_pull_request_reviews: {
              required_approving_review_count: 2,
              bypass_pull_request_allowances: {
                users: [{ id: 1 }],
                teams: [{ slug: "team-a" }],
                apps: [{ slug: "app-a" }]
              }
            },
            allow_force_pushes: { enabled: true },
            allow_deletions: { enabled: true }
          })
        );
      }
      return Promise.resolve(response({ default_branch: "main" }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });
    await expect(
      client.getBranchProtection({ owner: "octocat", repo: "demo", branch: "main" })
    ).resolves.toMatchObject({
      enforceAdmins: false,
      allowForcePushes: true,
      allowDeletions: true,
      requiredStatusChecks: { strict: false, checks: [{ name: "legacy-context" }] },
      requiredPullRequestReviews: {
        requiredApprovingReviewCount: 2,
        bypassActors: [
          { id: "1", type: "user" },
          { id: "team-a", type: "team" },
          { id: "app-a", type: "app" }
        ]
      }
    });

    const nullReviews = vi.fn(() =>
      Promise.resolve(
        response({
          enforce_admins: { enabled: true },
          allow_force_pushes: { enabled: false },
          allow_deletions: { enabled: false },
          required_status_checks: null,
          required_pull_request_reviews: null
        })
      )
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(nullReviews));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getBranchProtection({
        owner: "octocat",
        repo: "demo",
        branch: "main"
      })
    ).resolves.toMatchObject({
      requiredStatusChecks: null,
      requiredPullRequestReviews: null
    });
  });

  it("rejects malformed branch protection, ruleset, workflow, file, and tag data", async () => {
    const protectionCases = [
      { required_status_checks: { strict: true, checks: "bad" } },
      { required_status_checks: { strict: true } },
      { required_status_checks: { strict: true, checks: [], contexts: [1] } },
      {
        required_status_checks: { strict: true, checks: [] },
        required_pull_request_reviews: {
          required_approving_review_count: 1,
          bypass_pull_request_allowances: { users: "bad" }
        }
      }
    ];
    for (const data of protectionCases) {
      const request = vi.fn((route: string) =>
        route.endsWith("/protection")
          ? Promise.resolve(
              response({
                enforce_admins: { enabled: true },
                allow_force_pushes: { enabled: false },
                allow_deletions: { enabled: false },
                ...data
              })
            )
          : Promise.resolve(response({ default_branch: "main" }))
      );
      vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
      await expect(
        createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getBranchProtection({
          owner: "octocat",
          repo: "demo",
          branch: "main"
        })
      ).rejects.toThrow();
    }

    const invalidRuleset = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        if (params.page === 2) {
          return Promise.resolve(response([]));
        }
        return Promise.resolve(response([{ id: 1 }]));
      }
      return Promise.resolve(
        response({
          id: 1,
          name: "bad",
          target: "unknown",
          enforcement: "active",
          conditions: { ref_name: { include: ["~ALL"] } },
          rules: [],
          bypass_actors: []
        })
      );
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(invalidRuleset));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("ruleset-target-invalid");

    const invalidWorkflow = vi.fn((_route: string, params: Record<string, unknown>) =>
      Promise.resolve(
        response(params.page === 2 ? [] : [{ path: ".github/workflows/bad.yml", type: "socket" }])
      )
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(invalidWorkflow));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listWorkflowFiles({
        owner: "octocat",
        repo: "demo",
        ref: sha
      })
    ).rejects.toThrow("workflow-entry-type-invalid");

    const invalidFile = vi.fn(() => Promise.resolve(response({ content: "not raw text" })));
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(invalidFile));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getFileAtRevision({
        owner: "octocat",
        repo: "demo",
        path: ".reviewready.yml",
        ref: sha
      })
    ).rejects.toThrow("file-content-invalid");

    const invalidTags = vi.fn(() => Promise.resolve(response({ pattern: "*" })));
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(invalidTags));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getTagProtection({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("tag-protection-invalid");
  });

  it("covers malformed scalar fields and ruleset actor variants", async () => {
    const invalidBoolean = vi.fn((route: string) =>
      route.endsWith("/protection")
        ? Promise.resolve(
            response({
              required_status_checks: null,
              enforce_admins: { enabled: "yes" },
              allow_force_pushes: { enabled: false },
              allow_deletions: { enabled: false },
              required_pull_request_reviews: null
            })
          )
        : Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }))
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(invalidBoolean));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getBranchProtection({
        owner: "octocat",
        repo: "demo",
        branch: "main"
      })
    ).rejects.toThrow("response-boolean-invalid");

    const invalidInteger = vi.fn(() =>
      Promise.resolve(
        response({ owner: { login: "octocat" }, name: "demo", default_branch: "main", id: 0 })
      )
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(invalidInteger));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-integer-invalid");

    const actorRequest = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(response(params.page === 1 ? [{ id: 1 }] : []));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 1,
            name: "actors",
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~ALL"] } },
            rules: [],
            bypass_actors: [
              { actor_type: "user", actor_id: 1 },
              { actor_type: "team", actor_id: 2 },
              { actor_type: "integration", actor_id: 3 },
              { actor_type: "organizationadmin", actor_id: 4 },
              { actor_type: "repositoryrole", actor_id: 5 },
              { actor_type: "deploykey", actor_id: 6 },
              { actor_type: "other" }
            ]
          })
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(actorRequest));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).resolves.toMatchObject([
      {
        bypassActors: [
          { id: "1", type: "user" },
          { id: "2", type: "team" },
          { id: "3", type: "integration" },
          { id: "4", type: "app" },
          { id: "5", type: "app" },
          { id: "6", type: "app" },
          { id: "other" }
        ]
      }
    ]);
  });

  it("bounds nested API collections before mapping them", async () => {
    const oversizedChecks = vi.fn((route: string) =>
      route.endsWith("/protection")
        ? Promise.resolve(
            response({
              required_status_checks: {
                strict: true,
                checks: Array.from({ length: 101 }, () => ({ context: "ReviewReady" }))
              },
              enforce_admins: { enabled: true },
              allow_force_pushes: { enabled: false },
              allow_deletions: { enabled: false },
              required_pull_request_reviews: null
            })
          )
        : Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }))
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(oversizedChecks));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getBranchProtection({
        owner: "octocat",
        repo: "demo",
        branch: "main"
      })
    ).rejects.toThrow("required-checks-limit");

    const oversizedBypassActors = vi.fn((route: string) =>
      route.endsWith("/protection")
        ? Promise.resolve(
            response({
              required_status_checks: null,
              enforce_admins: { enabled: true },
              allow_force_pushes: { enabled: false },
              allow_deletions: { enabled: false },
              required_pull_request_reviews: {
                required_approving_review_count: 1,
                bypass_pull_request_allowances: {
                  users: Array.from({ length: 101 }, (_, index) => ({ id: index + 1 }))
                }
              }
            })
          )
        : Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }))
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(oversizedBypassActors));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getBranchProtection({
        owner: "octocat",
        repo: "demo",
        branch: "main"
      })
    ).rejects.toThrow("review-bypass-limit");

    const oversizedTagPatterns = vi.fn((route: string) =>
      route === "GET /repos/{owner}/{repo}/tags/protection"
        ? Promise.resolve(response(Array.from({ length: 101 }, () => ({ pattern: "v*" }))))
        : Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }))
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(oversizedTagPatterns));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getTagProtection({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("tag-protection-limit");

    const rulesetCases = [
      {
        code: "ruleset-scope-limit",
        detail: {
          conditions: { ref_name: { include: Array.from({ length: 101 }, () => "~ALL") } },
          rules: []
        }
      },
      {
        code: "ruleset-rules-limit",
        detail: {
          conditions: { ref_name: { include: ["~ALL"] } },
          rules: Array.from({ length: 101 }, () => ({ type: "deletion" }))
        }
      },
      {
        code: "ruleset-bypass-limit",
        detail: {
          conditions: { ref_name: { include: ["~ALL"] } },
          rules: [],
          bypass_actors: Array.from({ length: 101 }, () => ({ actor_type: "User", actor_id: 1 }))
        }
      },
      {
        code: "ruleset-checks-limit",
        detail: {
          conditions: { ref_name: { include: ["~ALL"] } },
          rules: [
            {
              type: "required_status_checks",
              parameters: {
                required_status_checks: Array.from({ length: 101 }, () => ({ context: "check" }))
              }
            }
          ],
          bypass_actors: []
        }
      },
      {
        code: "ruleset-checks-limit",
        detail: {
          conditions: { ref_name: { include: ["~ALL"] } },
          rules: [
            {
              type: "required_status_checks",
              parameters: {
                required_status_checks: Array.from({ length: 100 }, () => ({ context: "check" }))
              }
            },
            {
              type: "required_status_checks",
              parameters: {
                required_status_checks: Array.from({ length: 100 }, () => ({ context: "check" }))
              }
            }
          ],
          bypass_actors: []
        }
      }
    ] as const;

    for (const testCase of rulesetCases) {
      const request = vi.fn((route: string, params: Record<string, unknown>) => {
        if (route === "GET /repos/{owner}/{repo}/rulesets") {
          return Promise.resolve(params.page === 1 ? response([{ id: 1 }]) : response([]));
        }
        if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
          return Promise.resolve(
            response({
              id: 1,
              name: "main",
              target: "branch",
              enforcement: "active",
              ...testCase.detail
            })
          );
        }
        return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
      });
      vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
      await expect(
        createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
          owner: "octocat",
          repo: "demo"
        })
      ).rejects.toThrow(testCase.code);
    }
  });

  it("rejects ambiguous pagination and full-page continuation anomalies", async () => {
    const ambiguousLink = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        if (params.page === 1) {
          return Promise.resolve(
            response([{ id: 1 }], {
              link: '<https://api.github.com/one?page=2>; rel="next", <https://api.github.com/two?page=3>; rel="next"'
            })
          );
        }
        return Promise.resolve(response([]));
      }
      return Promise.reject(new Error("unexpected"));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(ambiguousLink));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("pagination-link-ambiguous");

    const invalidNext = vi.fn(() =>
      Promise.resolve(
        response([{ id: 1 }], {
          link: '<https://api.github.com/one?page=3>; rel="next"'
        })
      )
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(invalidNext));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("rulesets-pagination-invalid");
  });

  it("rejects an unlinked hidden page after a partial audit response", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(response(params.page === 1 ? [{ id: 1 }] : [{ id: 2 }], {}));
      }
      return Promise.reject(new Error("unexpected"));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("rulesets-pagination-ambiguous");
  });

  it("rejects duplicate ruleset identities across linked pages", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        if (params.page === 1) {
          return Promise.resolve(
            response([{ id: 7 }], {
              link: '<https://api.github.com/repos/octocat/demo/rulesets?page=2>; rel="next"'
            })
          );
        }
        return Promise.resolve(params.page === 2 ? response([{ id: 7 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 7,
            name: "main",
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
            bypass_actors: [],
            rules: []
          })
        );
      }
      return Promise.reject(new Error("unexpected route"));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("rulesets-duplicate");
  });

  it("does not request beyond the bounded pagination page budget", async () => {
    const pages: number[] = [];
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        pages.push(params.page as number);
        const page = params.page as number;
        return Promise.resolve(
          response(
            [{ id: page }],
            page < 10
              ? {
                  link: `<https://api.github.com/repos/octocat/demo/rulesets?page=${String(
                    page + 1
                  )}>; rel="next"`
                }
              : {}
          )
        );
      }
      return Promise.reject(new Error("unexpected detail request"));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("rulesets-pagination-limit");
    expect(pages).toEqual(Array.from({ length: 10 }, (_, index) => index + 1));
  });

  it("normalizes workflow extensions and tag protection patterns", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/contents/.github/workflows") {
        if (params.page === 2) {
          return Promise.resolve(response([]));
        }
        return Promise.resolve(
          response([
            { path: ".github/workflows/readme.md", type: "file" },
            { path: ".github/workflows/link.yml", type: "symlink" },
            { path: ".github/workflows/dir.yaml", type: "dir" },
            { path: ".github/workflows/sub.yml", type: "submodule" }
          ])
        );
      }
      if (route === "GET /repos/{owner}/{repo}/tags/protection") {
        return Promise.resolve(response([{ pattern: "v*" }, { pattern: "refs/tags/*" }]));
      }
      return Promise.resolve(response("raw text"));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });
    await expect(
      client.listWorkflowFiles({ owner: "octocat", repo: "demo", ref: sha })
    ).resolves.toEqual([
      { path: ".github/workflows/link.yml", type: "symlink" },
      { path: ".github/workflows/dir.yaml", type: "dir" },
      { path: ".github/workflows/sub.yml", type: "submodule" }
    ]);
    await expect(client.getTagProtection({ owner: "octocat", repo: "demo" })).resolves.toEqual({
      known: true,
      allowsDeletion: false,
      allowsUpdate: false
    });
  });
});
