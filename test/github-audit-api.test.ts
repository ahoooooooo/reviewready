import { beforeEach, describe, expect, it, vi } from "vitest";

import { endpoint } from "@octokit/endpoint";
import { getOctokit } from "@actions/github";

import { createGitHubAuditClient } from "../src/github-audit-api.js";

vi.mock("@actions/github", () => ({ getOctokit: vi.fn() }));

const sha = "a".repeat(40);

function expectedFetchUrl(
  baseUrl: string,
  route: string,
  parameters: Record<string, unknown>
): string {
  const template = route.slice(route.indexOf(" ") + 1);
  const pathParameters = new Set(
    [...template.matchAll(/\{([^{}]+)\}/gu)].map((entry) => entry[1] as string)
  );
  const scalar = (value: unknown): string => {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      return String(value);
    }
    throw new Error("test route parameter is not scalar");
  };
  const encode = (value: unknown): string =>
    encodeURIComponent(scalar(value)).replace(
      /[!'()*]/gu,
      (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase()
    );
  const path = template.replace(/\{([^{}]+)\}/gu, (_placeholder, name: string) =>
    encode(parameters[name])
  );
  const target = new URL(baseUrl.replace(/\/+$/u, "") + path);
  for (const [key, value] of Object.entries(parameters)) {
    if (pathParameters.has(key) || key === "request" || key === "headers" || value === undefined) {
      continue;
    }
    target.searchParams.append(key, scalar(value));
  }
  return target.toString();
}

it("keeps URL attestation aligned with the real Octokit endpoint encoder", () => {
  const baseUrl = "https://ghe.example/api/v3";
  const route = "GET /repos/{owner}/{repo}/contents/{path}";
  const parameters = {
    owner: "octocat",
    repo: "demo",
    path: ".github/workflows/a.yml",
    ref: sha
  };

  expect(endpoint(route, { baseUrl, ...parameters }).url).toBe(
    expectedFetchUrl(baseUrl, route, parameters)
  );
});

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
          owner: { login: "octocat", type: "Organization" },
          name: "demo",
          id: 123,
          visibility: "public"
        }
      : data;
  return { data: normalizedData, headers, status: 200 };
}

function octokitWithTransport(
  request: unknown,
  fetchImplementation?: unknown,
  baseUrl = "https://api.github.com",
  options: { readonly autoInvokeFetch?: boolean } = {}
): never {
  const callable = request as ((...arguments_: never[]) => unknown) & {
    readonly endpoint?: unknown;
    readonly defaults?: unknown;
  };
  const baseRequest = request as (
    route: string,
    params: Record<string, unknown>
  ) => Promise<unknown>;
  Object.assign(callable, {
    endpoint: {
      DEFAULTS: {
        baseUrl,
        request: {
          fetch: fetchImplementation ?? (() => Promise.resolve(new Response("", { status: 200 })))
        }
      }
    },
    defaults: (defaults: unknown) => {
      const configured = defaults as {
        readonly request?: { readonly fetch?: typeof globalThis.fetch };
      };
      if (options.autoInvokeFetch === false) {
        return request;
      }
      const boundedFetch = configured.request?.fetch;
      if (boundedFetch === undefined) {
        return request;
      }
      return async (route: string, params: Record<string, unknown>) => {
        const state = { observed: false };
        const fetch = ((...arguments_: Parameters<typeof globalThis.fetch>) => {
          state.observed = true;
          const [input, init] = arguments_;
          const mappedInput =
            typeof input === "string" && input === baseUrl
              ? expectedFetchUrl(baseUrl, route, params)
              : input;
          return boundedFetch(mappedInput, init);
        }) as typeof globalThis.fetch;
        const originalRequest =
          typeof params.request === "object" && params.request !== null
            ? (params.request as Record<string, unknown>)
            : {};
        try {
          const result = await baseRequest(route, {
            ...params,
            request: { ...originalRequest, fetch }
          });
          if (!state.observed) {
            await fetch(baseUrl);
          }
          return result;
        } catch (error) {
          if (!state.observed) {
            await fetch(baseUrl);
          }
          throw error;
        }
      };
    }
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
      const requestOptions = params.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      return requestOptions.fetch("https://api.github.com").then(async (fetched) => ({
        data: await fetched.text(),
        headers: {},
        status: fetched.status
      }));
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
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, () =>
        Promise.resolve(new Response("on: pull_request\njobs: {}", { status: 200 }))
      )
    );
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "repository-identity-mismatch"
    );
  });

  it("rejects an API endpoint with an unsafe scheme before creating a client", () => {
    const request = vi.fn();
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, undefined, "http://attacker.example/api")
    );

    expect(() => createGitHubAuditClient("secret")).toThrow("api-base-url-invalid");
  });

  it("rejects a bounded fetch target outside the configured API endpoint", async () => {
    const request = vi.fn(async (_route: string, parameters: Record<string, unknown>) => {
      const requestOptions = parameters.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      await requestOptions.fetch("https://attacker.example/forged");
      return response({
        owner: { login: "octocat", type: "Organization" },
        name: "demo",
        id: 123,
        visibility: "public",
        default_branch: "main"
      });
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-target-untrusted");
  });

  it("captures an encoded contents route against an Enterprise API base", async () => {
    const captured: string[] = [];
    const request = vi.fn(async (route: string, parameters: Record<string, unknown>) => {
      const requestOptions = parameters.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      const target =
        route === "GET /repos/{owner}/{repo}/contents/{path}"
          ? "https://ghe.example/api/v3/repos/octocat/demo/contents/.github%2Fworkflows%2Ftrusted.yml?ref=" +
            sha
          : "https://ghe.example/api/v3/repos/octocat/demo";
      captured.push(target);
      const fetched = await requestOptions.fetch(target);
      return { data: await fetched.text(), headers: {}, status: fetched.status };
    });
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, undefined, "https://ghe.example/api/v3")
    );

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getFileAtRevision({
        owner: "octocat",
        repo: "demo",
        path: ".github/workflows/trusted.yml",
        ref: sha
      })
    ).resolves.toBe("");
    expect(captured).toEqual([
      "https://ghe.example/api/v3/repos/octocat/demo/contents/.github%2Fworkflows%2Ftrusted.yml?ref=" +
        sha
    ]);
  });

  it("rejects a same-origin fetch target for a different API route", async () => {
    const request = vi.fn(async (_route: string, parameters: Record<string, unknown>) => {
      const requestOptions = parameters.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      await requestOptions.fetch("https://api.github.com/repos/octocat/demo/branches/main");
      return response({
        owner: { login: "octocat", type: "Organization" },
        name: "demo",
        id: 123,
        visibility: "public",
        default_branch: "main"
      });
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-target-untrusted");
  });

  it("maps read-only GitHub responses into the collector contract", async () => {
    const request = fakeRequest();
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, () =>
        Promise.resolve(new Response("on: pull_request\njobs: {}", { status: 200 }))
      )
    );
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).resolves.toEqual({
      owner: "octocat",
      name: "demo",
      defaultBranch: "main",
      id: 123,
      ownerType: "organization",
      visibility: "public"
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

  it("accepts a bounded unpaginated workflow directory without probing a fake page", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      void params;
      if (route === "GET /repos/{owner}/{repo}/contents/.github/workflows") {
        return Promise.resolve(
          response([{ path: ".github/workflows/reviewready-trusted.yml", type: "file" }])
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listWorkflowFiles({
        owner: "octocat",
        repo: "demo",
        ref: sha
      })
    ).resolves.toEqual([{ path: ".github/workflows/reviewready-trusted.yml", type: "file" }]);
    expect(request).toHaveBeenCalledTimes(1);
    const parameters = request.mock.calls[0]?.[1];
    expect(parameters).toMatchObject({ ref: sha });
    expect(parameters).not.toHaveProperty("page");
    expect(parameters).not.toHaveProperty("per_page");
  });

  it.each([
    [
      "missing headers",
      { data: [{ path: ".github/workflows/one.yml", type: "file" }], status: 200 }
    ],
    [
      "null headers",
      { data: [{ path: ".github/workflows/one.yml", type: "file" }], headers: null, status: 200 }
    ],
    [
      "non-object headers",
      {
        data: [{ path: ".github/workflows/one.yml", type: "file" }],
        headers: "invalid",
        status: 200
      }
    ]
  ] as const)("rejects workflow directories with %s metadata", async (_label, rawResponse) => {
    const request = vi.fn(() => Promise.resolve(rawResponse));
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listWorkflowFiles({
        owner: "octocat",
        repo: "demo",
        ref: sha
      })
    ).rejects.toThrow("response-header-invalid");
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
        id: 8,
        target: "push",
        refPatterns: [],
        allowForcePushes: undefined,
        allowDeletions: undefined
      }
    ]);
  });

  it("rejects unknown ruleset rule types and parameters instead of ignoring them", async () => {
    const cases: readonly [Record<string, unknown>, string][] = [
      [{ type: "file_extension_restriction" }, "ruleset-rule-unsupported"],
      [{ type: "deletion", parameters: {} }, "ruleset-rule-parameters"]
    ];
    for (const [rule, code] of cases) {
      const request = vi.fn((route: string, params: Record<string, unknown>) => {
        if (route === "GET /repos/{owner}/{repo}/rulesets") {
          return Promise.resolve(params.page === 1 ? response([{ id: 8 }]) : response([]));
        }
        if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
          return Promise.resolve(
            response({
              id: 8,
              name: "unsupported-rule",
              target: "push",
              enforcement: "active",
              conditions: {},
              bypass_actors: [],
              rules: [rule]
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
      ).rejects.toThrow(code);
    }
  });

  it.each([
    [
      {
        type: "pull_request",
        parameters: {
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: true,
          required_reviewers: []
        }
      },
      "ruleset-review-semantics-unsupported"
    ],
    [
      {
        type: "required_status_checks",
        parameters: {
          do_not_enforce_on_create: false,
          required_status_checks: [{ context: "check", integration_id: 15368 }],
          strict_required_status_checks_policy: true
        }
      },
      "ruleset-status-semantics-unsupported"
    ]
  ])(
    "rejects official ruleset semantics that the v1 snapshot cannot preserve",
    async (rule, code) => {
      const request = vi.fn((route: string, params: Record<string, unknown>) => {
        if (route === "GET /repos/{owner}/{repo}/rulesets") {
          return Promise.resolve(params.page === 1 ? response([{ id: 13 }]) : response([]));
        }
        if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
          return Promise.resolve(
            response({
              id: 13,
              name: "official-unsupported-semantics",
              target: "branch",
              enforcement: "active",
              conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
              bypass_actors: [],
              rules: [rule]
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
      ).rejects.toThrow(code);
    }
  );

  it("rejects unmodeled ruleset top-level fields instead of ignoring provenance", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(params.page === 1 ? response([{ id: 10 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 10,
            name: "unmodeled-provenance",
            target: "branch",
            enforcement: "active",
            future_field: "unmodeled",
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
    ).rejects.toThrow("ruleset-field-unsupported");
  });

  it("accepts the official ruleset metadata envelope and validates repository scope", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(params.page === 1 ? response([{ id: 11 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 11,
            name: "official-envelope",
            target: "branch",
            source_type: "Repository",
            source: "octocat/demo",
            enforcement: "active",
            node_id: "RRS_lACkVXNlcgQB",
            _links: {
              self: { href: "https://api.github.com/repos/octocat/demo/rulesets/11" },
              html: { href: "https://github.com/octocat/demo/rules/11" }
            },
            created_at: "2023-07-15T08:43:03Z",
            updated_at: "2023-08-23T16:29:47Z",
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
        repo: "demo",
        ownerType: "user"
      })
    ).resolves.toMatchObject([{ id: 11, target: "branch" }]);
  });

  it("rejects unknown ruleset bypass actor fields", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(params.page === 1 ? response([{ id: 12 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 12,
            name: "actor-extra",
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
            bypass_actors: [
              { actor_type: "User", actor_id: 1, bypass_mode: "always", future_scope: "all" }
            ],
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
    ).rejects.toThrow("ruleset-bypass-field-unsupported");
  });

  it("rejects malformed ruleset bypass actor shapes instead of treating them as hidden", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(params.page === 1 ? response([{ id: 9 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 9,
            name: "malformed-bypass",
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
            bypass_actors: {},
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
    ).rejects.toThrow("ruleset-bypass-invalid");
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
    expect(client.getRequestMetrics?.()).toEqual({ requestAttempts: 2, retryAttempts: 1 });
  });

  it("does not count a budget-rejected request beyond the bounded attempt total", async () => {
    const request = vi.fn(async (_route: string, params: Record<string, unknown>) => {
      const requestOptions = params.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      await requestOptions.fetch("https://api.github.com");
      return response({
        default_branch: "main",
        owner: { login: "octocat", type: "Organization" },
        name: "demo",
        id: 123,
        visibility: "public"
      });
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    for (let index = 0; index < 768; index += 1) {
      await expect(client.getRepository({ owner: "octocat", repo: "demo" })).resolves.toBeDefined();
    }
    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "request-budget-exceeded"
    );
    expect(request).toHaveBeenCalledTimes(768);
    expect(client.getRequestMetrics?.()).toEqual({ requestAttempts: 768, retryAttempts: 0 });
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

  it("does not trust a spoofed typed-array byteLength in streamed responses", async () => {
    const payload = new Uint8Array(2 * 1024 * 1024 + 1);
    Object.defineProperty(payload, "byteLength", { configurable: true, value: 0 });
    const setSpy = vi.spyOn(Uint8Array.prototype, "set");
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: payload })
        .mockResolvedValueOnce({ done: true }),
      cancel: vi.fn(() => Promise.resolve())
    };
    const fetchImplementation = vi.fn(() =>
      Promise.resolve({
        body: { getReader: () => reader },
        headers: new Headers(),
        status: 200,
        statusText: "OK"
      })
    );
    const request = vi.fn(async (_route: string, parameters: Record<string, unknown>) => {
      const requestOptions = parameters.request as {
        readonly fetch: typeof globalThis.fetch;
      };
      const bounded = await requestOptions.fetch("https://api.github.com");
      if (bounded.status !== 200) {
        throw Object.assign(new Error("response too large"), { status: 413 });
      }
      return response({ default_branch: "main" });
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request, fetchImplementation));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "request-failed"
    );
    expect(reader.cancel).toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it("rejects a response without an explicit HTTP status", async () => {
    const request = vi.fn(() => Promise.resolve({ data: { default_branch: "main" }, headers: {} }));
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "response-status-invalid"
    );
  });

  it("rejects a workflow directory response carrying any pagination link", async () => {
    const request = vi.fn((route: string) => {
      if (route !== "GET /repos/{owner}/{repo}/contents/.github/workflows") {
        return Promise.reject(new Error("unexpected route"));
      }
      return Promise.resolve(
        response([{ path: ".github/workflows/one.yml", type: "file" }], {
          link: `<https://api.github.com/repos/octocat/demo/contents/.github/workflows?ref=${sha}>; rel="next"`
        })
      );
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(
      client.listWorkflowFiles({ owner: "octocat", repo: "demo", ref: sha })
    ).rejects.toThrow("workflows-pagination-unsupported");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects a workflow directory response that exceeds the audit bound", async () => {
    const entries = Array.from({ length: 101 }, (_, index) => ({
      path: `.github/workflows/workflow-${String(index)}.yml`,
      type: "file"
    }));
    const request = vi.fn((route: string) => {
      if (route !== "GET /repos/{owner}/{repo}/contents/.github/workflows") {
        return Promise.reject(new Error("unexpected route"));
      }
      return Promise.resolve(response(entries));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(
      client.listWorkflowFiles({ owner: "octocat", repo: "demo", ref: sha })
    ).rejects.toThrow("workflows-limit");
    expect(request).toHaveBeenCalledTimes(1);
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

  it("rejects a required ruleset actor without a stable actor ID", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(params.page === 1 ? response([{ id: 9 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 9,
            name: "missing-actor-id",
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~ALL"] } },
            bypass_actors: [{ actor_type: "User" }],
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
        repo: "demo",
        ownerType: "organization"
      })
    ).rejects.toThrow("actor-identity-invalid");
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

  it.each([
    ["invalid", "not-a-number", "response-header-invalid"],
    ["oversized", String(3 * 1024 * 1024), "response-size-limit"]
  ])("rejects a malformed transport byte header (%s)", async (_name, value, expected) => {
    const request = vi.fn(() =>
      Promise.resolve(
        response({ default_branch: "main" }, { "x-reviewready-response-bytes": value })
      )
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow(expected);
  });

  it("fails closed when no bounded transport measurement is present", async () => {
    const request = vi.fn(() =>
      Promise.resolve(response({ default_branch: "main" }, { "content-length": "1024" }))
    );
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, undefined, undefined, {
        autoInvokeFetch: false
      })
    );

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-boundary-unavailable");
  });

  it("rejects an operation whose aggregate response bytes exceed the global bound", async () => {
    const data = {
      owner: { login: "octocat", type: "Organization" },
      name: "demo",
      id: 123,
      visibility: "public",
      default_branch: "main"
    };
    const serialized = JSON.stringify(data);
    const body = serialized + " ".repeat(2 * 1024 * 1024 - serialized.length);
    const request = vi.fn(async (_route: string, params: Record<string, unknown>) => {
      const requestOptions = params.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      const fetched = await requestOptions.fetch(
        expectedFetchUrl("https://api.github.com", _route, params)
      );
      return {
        data: JSON.parse(await fetched.text()) as unknown,
        headers: fetched.headers,
        status: fetched.status
      };
    });
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, () => Promise.resolve(new Response(body, { status: 200 })))
    );
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(
      (async () => {
        for (let index = 0; index < 40; index += 1) {
          await client.getRepository({ owner: "octocat", repo: "demo" });
        }
      })()
    ).rejects.toThrow("response-total-size-limit");
  });

  it("counts bounded wire bytes even when JSON parsing removes padding", async () => {
    const data = {
      owner: { login: "octocat", type: "Organization" },
      name: "demo",
      id: 123,
      visibility: "public",
      default_branch: "main"
    };
    const serialized = JSON.stringify(data);
    const body = serialized + " ".repeat(2 * 1024 * 1024 - serialized.length);
    const request = vi.fn(async (_route: string, params: Record<string, unknown>) => {
      const requestOptions = params.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      const fetched = await requestOptions.fetch(
        expectedFetchUrl("https://api.github.com", _route, params)
      );
      const parsed = JSON.parse(await fetched.text()) as unknown;
      return {
        data: parsed,
        headers: fetched.headers,
        status: fetched.status
      };
    });
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, () => Promise.resolve(new Response(body, { status: 200 })))
    );
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(
      (async () => {
        for (let index = 0; index < 40; index += 1) {
          await client.getRepository({ owner: "octocat", repo: "demo" });
        }
      })()
    ).rejects.toThrow("response-total-size-limit");
  });

  it("fails closed when an adapter drops or falsifies bounded transport byte metadata", async () => {
    const data = {
      owner: { login: "octocat", type: "Organization" },
      name: "demo",
      id: 123,
      visibility: "public",
      default_branch: "main"
    };
    const serialized = JSON.stringify(data);
    const body = serialized + " ".repeat(2 * 1024 * 1024 - serialized.length);
    const request = vi.fn(async (_route: string, params: Record<string, unknown>) => {
      const requestOptions = params.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      const fetched = await requestOptions.fetch(
        expectedFetchUrl("https://api.github.com", _route, params)
      );
      const parsed = JSON.parse(await fetched.text()) as unknown;
      return { data: parsed, headers: { "x-reviewready-response-bytes": "0" }, status: 200 };
    });
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, () => Promise.resolve(new Response(body, { status: 200 })))
    );
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(
      (async () => {
        for (let index = 0; index < 40; index += 1) {
          await client.getRepository({ owner: "octocat", repo: "demo" });
        }
      })()
    ).rejects.toThrow("response-total-size-limit");
  });

  it("fails closed when an adapter bypasses the bounded transport entirely", async () => {
    const data = {
      owner: { login: "octocat", type: "Organization" },
      name: "demo",
      id: 123,
      visibility: "public",
      default_branch: "main"
    };
    const request = vi.fn(() =>
      Promise.resolve(response(data, { "x-reviewready-response-bytes": "0" }))
    );
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(
        request,
        () => Promise.resolve(new Response("untrusted body", { status: 200 })),
        "https://api.github.com",
        { autoInvokeFetch: false }
      )
    );
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "response-boundary-unavailable"
    );
  });

  it("fails closed when an adapter rejects before bounded transport observation", async () => {
    const request = vi.fn(() =>
      Promise.reject(Object.assign(new Error("untrusted adapter failure"), { status: 503 }))
    );
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, undefined, undefined, { autoInvokeFetch: false })
    );
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "response-boundary-unavailable"
    );
  });

  it("bounds fetches performed repeatedly inside one adapter call", async () => {
    const request = vi.fn(async (_route: string, params: Record<string, unknown>) => {
      const requestOptions = params.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      for (let index = 0; index < 769; index += 1) {
        await requestOptions.fetch("https://api.github.com");
      }
      return response({ default_branch: "main" });
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "request-budget-exceeded"
    );
  });

  it("enforces the audit deadline when an adapter never settles", async () => {
    const request = vi.fn(() => new Promise<never>(() => undefined));
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, undefined, undefined, { autoInvokeFetch: false })
    );
    const client = createGitHubAuditClient("secret", {
      deadlineMs: 10,
      sleep: () => Promise.resolve()
    });
    const operation = client.getRepository({ owner: "octocat", repo: "demo" });
    const timeout = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error("test timeout"));
      }, 250);
    });

    await expect(Promise.race([operation, timeout])).rejects.toThrow("audit-deadline-exceeded");
  });

  it("bounds a stream that emits too many zero-byte chunks", async () => {
    const cancel = vi.fn(() => Promise.resolve());
    const reader = {
      read: vi.fn(() => Promise.resolve({ done: false, value: new Uint8Array(0) })),
      cancel
    };
    const fetchImplementation = vi.fn(() =>
      Promise.resolve({
        body: { getReader: () => reader },
        headers: new Headers(),
        status: 200,
        statusText: "OK"
      })
    );
    const request = vi.fn(async (_route: string, parameters: Record<string, unknown>) => {
      const requestOptions = parameters.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      await requestOptions.fetch("https://api.github.com");
      return response({ default_branch: "main" });
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request, fetchImplementation));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-size-limit");
    expect(cancel).toHaveBeenCalled();
  });

  it("bounds retry sleep by the overall audit deadline", async () => {
    const request = vi.fn(async (_route: string, parameters: Record<string, unknown>) => {
      const requestOptions = parameters.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      await requestOptions.fetch("https://api.github.com");
      throw Object.assign(new Error("upstream unavailable"), {
        response: { headers: { "retry-after": "0" } },
        status: 503
      });
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const operation = createGitHubAuditClient("secret", {
      deadlineMs: 20,
      sleep: () => new Promise<void>(() => undefined)
    }).getRepository({ owner: "octocat", repo: "demo" });
    const timeout = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error("test timeout"));
      }, 250);
    });

    await expect(Promise.race([operation, timeout])).rejects.toThrow("audit-deadline-exceeded");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("prefers an expired audit deadline over a late non-retryable request error", async () => {
    let current = 100;
    const request = vi.fn(() => {
      current = 151;
      throw Object.assign(new Error("bad request"), { status: 400 });
    });
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, undefined, undefined, { autoInvokeFetch: false })
    );

    await expect(
      createGitHubAuditClient("secret", {
        deadlineMs: 50,
        now: () => current,
        sleep: () => Promise.resolve()
      }).getRepository({ owner: "octocat", repo: "demo" })
    ).rejects.toThrow("audit-deadline-exceeded");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("normalizes throwing error-property access at the API boundary", async () => {
    const failure = new Proxy(new Error("attacker error"), {
      get() {
        throw new Error("attacker error getter");
      }
    });
    const request = vi.fn(async (_route: string, parameters: Record<string, unknown>) => {
      const requestOptions = parameters.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      await requestOptions.fetch("https://api.github.com");
      throw failure;
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-error-invalid");
  });

  it("cancels a bounded response reader when the audit deadline expires", async () => {
    const cancel = vi.fn(() => Promise.resolve());
    const reader = {
      read: vi.fn(() => new Promise<never>(() => undefined)),
      cancel
    };
    const fetchImplementation = vi.fn(() =>
      Promise.resolve({
        body: { getReader: () => reader },
        headers: new Headers(),
        status: 200,
        statusText: "OK"
      })
    );
    const request = vi.fn(async (_route: string, parameters: Record<string, unknown>) => {
      const requestOptions = parameters.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      await requestOptions.fetch("https://api.github.com");
      return response({ default_branch: "main" });
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request, fetchImplementation));
    const client = createGitHubAuditClient("secret", {
      deadlineMs: 10,
      sleep: () => Promise.resolve()
    });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "audit-deadline-exceeded"
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalled();
  });

  it("counts an oversized streamed error response toward the aggregate bound", async () => {
    const oversizedBody = new Uint8Array(2 * 1024 * 1024 + 1);
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(new Response(oversizedBody, { status: 503 }))
    );
    const request = vi.fn(async (_route: string, params: Record<string, unknown>) => {
      const requestOptions = params.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      const fetched = await requestOptions.fetch(
        expectedFetchUrl("https://api.github.com", _route, params)
      );
      throw Object.assign(new Error("upstream unavailable"), {
        response: { headers: Object.fromEntries(fetched.headers.entries()) },
        status: 503
      });
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request, fetchImplementation));
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });
    let aggregateFailure: unknown;

    for (let index = 0; index < 40 && aggregateFailure === undefined; index += 1) {
      try {
        await client.getRepository({ owner: "octocat", repo: "demo" });
      } catch (error) {
        if (error instanceof Error && error.message.includes("response-total-size-limit")) {
          aggregateFailure = error;
        }
      }
    }

    expect(aggregateFailure).toBeInstanceOf(Error);
  });

  it("counts bounded bytes from retryable error responses", async () => {
    const body = " ".repeat(2 * 1024 * 1024);
    const request = vi.fn(async (_route: string, params: Record<string, unknown>) => {
      const requestOptions = params.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      const fetched = await requestOptions.fetch("https://api.github.com", { method: "GET" });
      const failure = Object.assign(new Error("upstream unavailable"), {
        response: { headers: Object.fromEntries(fetched.headers.entries()) },
        status: 503
      });
      throw failure;
    });
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, () => Promise.resolve(new Response(body, { status: 503 })))
    );
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });
    let aggregateFailure: unknown;

    for (let index = 0; index < 40 && aggregateFailure === undefined; index += 1) {
      try {
        await client.getRepository({ owner: "octocat", repo: "demo" });
      } catch (error) {
        if (error instanceof Error && error.message.includes("response-total-size-limit")) {
          aggregateFailure = error;
        }
      }
    }

    expect(aggregateFailure).toBeInstanceOf(Error);
  });

  it("counts wire bytes before response-data validation fails", async () => {
    const circular: Record<string, unknown> = { default_branch: "main" };
    circular.self = circular;
    const request = vi.fn(async (_route: string, params: Record<string, unknown>) => {
      const requestOptions = params.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      await requestOptions.fetch("https://api.github.com");
      return response(circular);
    });
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, () =>
        Promise.resolve(new Response(" ".repeat(2 * 1024 * 1024), { status: 200 }))
      )
    );
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });
    let aggregateFailure: unknown;

    for (let index = 0; index < 40 && aggregateFailure === undefined; index += 1) {
      try {
        await client.getRepository({ owner: "octocat", repo: "demo" });
      } catch (error) {
        if (error instanceof Error && error.message.includes("response-total-size-limit")) {
          aggregateFailure = error;
        }
      }
    }

    expect(aggregateFailure).toBeInstanceOf(Error);
  });

  it("counts structured adapter data toward the aggregate response bound", async () => {
    const data = {
      owner: { login: "octocat", type: "Organization" },
      name: "demo",
      id: 123,
      visibility: "public",
      default_branch: "main",
      padding: "x".repeat(1_800_000)
    };
    const request = vi.fn(async (_route: string, parameters: Record<string, unknown>) => {
      const requestOptions = parameters.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      const fetched = await requestOptions.fetch("https://api.github.com");
      return { data, headers: fetched.headers, status: fetched.status };
    });
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, () => Promise.resolve(new Response("x", { status: 200 })))
    );
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });
    let aggregateFailure: unknown;

    for (let index = 0; index < 40 && aggregateFailure === undefined; index += 1) {
      try {
        await client.getRepository({ owner: "octocat", repo: "demo" });
      } catch (error) {
        if (error instanceof Error && error.message.includes("response-total-size-limit")) {
          aggregateFailure = error;
        }
      }
    }

    expect(aggregateFailure).toBeInstanceOf(Error);
  });

  it("normalizes exceptions from untrusted response header access", async () => {
    const headers = {
      get: () => {
        throw new Error("attacker header getter");
      }
    };
    const request = vi.fn(() =>
      Promise.resolve({
        data: { default_branch: "main" },
        headers,
        status: 200
      })
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-header-invalid");
  });

  it("normalizes exceptions from an untrusted response headers get getter", async () => {
    const headers = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "get") {
            throw new Error("attacker headers get getter");
          }
          return undefined;
        }
      }
    );
    const request = vi.fn(() =>
      Promise.resolve({
        data: { default_branch: "main" },
        headers,
        status: 200
      })
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-header-invalid");
  });

  it("normalizes exceptions from an untrusted response headers property", async () => {
    const responseObject = new Proxy(response({ default_branch: "main" }), {
      get(target, property, receiver) {
        if (property === "headers") {
          throw new Error("attacker response headers getter");
        }
        return Reflect.get(target, property, receiver) as unknown;
      }
    });
    const request = vi.fn(() => Promise.resolve(responseObject));
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-object-invalid");
  });

  it("normalizes exceptions from nested error response data", async () => {
    const errorResponse = new Proxy(
      { headers: {}, data: { message: "denied" } },
      {
        get(target, property, receiver) {
          if (property === "data") {
            throw new Error("attacker response data getter");
          }
          return Reflect.get(target, property, receiver) as unknown;
        }
      }
    );
    const failure = Object.assign(new Error("denied"), {
      response: errorResponse,
      status: 400
    });
    const request = vi.fn(async (_route: string, parameters: Record<string, unknown>) => {
      const requestOptions = parameters.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      await requestOptions.fetch("https://api.github.com");
      throw failure;
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-error-invalid");
  });

  it("keeps raw workflow and policy source within the analyzer limit", async () => {
    const request = vi.fn(async (_route: string, parameters: Record<string, unknown>) => {
      const requestOptions = parameters.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      const fetched = await requestOptions.fetch(
        expectedFetchUrl("https://api.github.com", _route, parameters)
      );
      return { data: await fetched.text(), headers: {}, status: fetched.status };
    });
    const rawRequest = Object.assign(request, {
      endpoint: {
        DEFAULTS: {
          request: {
            fetch: () => Promise.resolve(new Response("x".repeat(256 * 1024 + 1), { status: 200 }))
          }
        }
      },
      defaults: () => request
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
    ).rejects.toThrow("file-content-invalid");
  });

  it("preserves a valid U+FFFD in raw source instead of treating it as lossy decoding", async () => {
    const source = "on: pull_request\n\uFFFD";
    const baseFetch = vi.fn(() =>
      Promise.resolve(new Response(new TextEncoder().encode(source), { status: 200 }))
    );
    const request = vi.fn(async (_route: string, parameters: Record<string, unknown>) => {
      const requestOptions = parameters.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      const fetched = await requestOptions.fetch(
        expectedFetchUrl("https://api.github.com", _route, parameters)
      );
      return { data: await fetched.text(), headers: {}, status: fetched.status };
    });
    const rawRequest = Object.assign(request, {
      endpoint: { DEFAULTS: { request: { fetch: baseFetch } } },
      defaults: () => request
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
    ).resolves.toBe(source);
  });

  it("preserves a UTF-8 BOM in raw source instead of stripping source bytes", async () => {
    const source = "\uFEFFon: pull_request\njobs: {}";
    const baseFetch = vi.fn(() =>
      Promise.resolve(new Response(new TextEncoder().encode(source), { status: 200 }))
    );
    const request = vi.fn(async (_route: string, parameters: Record<string, unknown>) => {
      const requestOptions = parameters.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      const fetched = await requestOptions.fetch(
        expectedFetchUrl("https://api.github.com", _route, parameters)
      );
      return { data: await fetched.text(), headers: {}, status: fetched.status };
    });
    const rawRequest = Object.assign(request, {
      endpoint: { DEFAULTS: { request: { fetch: baseFetch } } },
      defaults: () => request
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
    ).resolves.toBe(source);
  });

  it("rejects invalid UTF-8 in raw source instead of replacement decoding", async () => {
    const request = vi.fn(async (_route: string, parameters: Record<string, unknown>) => {
      const requestOptions = parameters.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      const fetched = await requestOptions.fetch(
        expectedFetchUrl("https://api.github.com", _route, parameters)
      );
      return { data: await fetched.text(), headers: {}, status: fetched.status };
    });
    const rawRequest = Object.assign(request, {
      endpoint: {
        DEFAULTS: {
          request: {
            fetch: () =>
              Promise.resolve(new Response(new Uint8Array([0x6f, 0xc3, 0x28]), { status: 200 }))
          }
        }
      },
      defaults: () => request
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
    ).rejects.toThrow("file-content-invalid");
  });

  it("rejects out-of-range App IDs at the GitHub API boundary", async () => {
    const branchRequest = vi.fn((route: string) =>
      route.endsWith("/protection")
        ? Promise.resolve(
            response({
              required_status_checks: {
                strict: true,
                checks: [{ context: "check", app_id: 0 }]
              },
              enforce_admins: { enabled: true },
              allow_force_pushes: { enabled: false },
              allow_deletions: { enabled: false },
              required_pull_request_reviews: null
            })
          )
        : Promise.resolve(response({ default_branch: "main" }))
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(branchRequest));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getBranchProtection({
        owner: "octocat",
        repo: "demo",
        branch: "main"
      })
    ).rejects.toThrow("response-app-id-invalid");

    const rulesetRequest = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(params.page === 1 ? response([{ id: 13 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 13,
            name: "bad-app-id",
            target: "push",
            enforcement: "active",
            conditions: {},
            bypass_actors: [],
            rules: [
              {
                type: "required_status_checks",
                parameters: {
                  required_status_checks: [{ context: "check", integration_id: 2_147_483_648 }]
                }
              }
            ]
          })
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(rulesetRequest));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-app-id-invalid");
  });

  it("fails closed when a raw request returns parser data without byte capture", async () => {
    const request = vi.fn(() => Promise.resolve(response("on: pull_request\njobs: {}")));
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, undefined, undefined, { autoInvokeFetch: false })
    );
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(
      client.getFileAtRevision({
        owner: "octocat",
        repo: "demo",
        path: ".github/workflows/reviewready.yml",
        ref: sha
      })
    ).rejects.toThrow("response-boundary-unavailable");
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
      const boundedResponse = await fetchImplementation(
        expectedFetchUrl("https://api.github.com", _route, parameters)
      );
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
        const boundedResponse = await fetchImplementation(
          expectedFetchUrl("https://api.github.com", _route, parameters)
        );
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
    const parserRequest = vi.fn(async (route: string, parameters: Record<string, unknown>) => {
      if (boundedFetch === undefined) {
        throw new Error("bounded fetch was not installed");
      }
      const parsedResponse = await boundedFetch(
        expectedFetchUrl("https://api.github.com", route, parameters)
      );
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
    const parserRequest = vi.fn(async (route: string, parameters: Record<string, unknown>) => {
      if (boundedFetch === undefined) {
        throw new Error("bounded fetch was not installed");
      }
      const parsedResponse = await boundedFetch(
        expectedFetchUrl("https://api.github.com", route, parameters)
      );
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
      const requestOptions = params.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      const observed = requestOptions.fetch("https://api.github.com");
      if (route === "GET /repos/{owner}/{repo}") {
        return observed.then(() => response({ default_branch: "main" }));
      }
      if (route === "GET /repos/{owner}/{repo}/branches/{branch}") {
        return observed.then(() => response({ name: "main", commit: { sha } }));
      }
      if (route === "GET /repos/{owner}/{repo}/branches/{branch}/protection") {
        return observed.then(() =>
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
        return observed.then(() => response(params.page === 1 ? ruleSummaries : []));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        const id = params.ruleset_id;
        return observed.then(() =>
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
        expect(params).toMatchObject({ ref: sha });
        expect(params).not.toHaveProperty("page");
        expect(params).not.toHaveProperty("per_page");
        return observed.then(() => response(workflowEntries));
      }
      if (route === "GET /repos/{owner}/{repo}/contents/{path}") {
        const requestOptions = params.request as {
          readonly fetch?: typeof globalThis.fetch;
        };
        if (typeof requestOptions.fetch !== "function") {
          throw new Error("bounded fetch was not passed");
        }
        return requestOptions
          .fetch("https://api.github.com")
          .then(async (fetched) => response(await fetched.text()));
      }
      if (route === "GET /repos/{owner}/{repo}/tags/protection") {
        return Promise.resolve(response([{ pattern: "*" }]));
      }
      throw new Error("unexpected route");
    });
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, () =>
        Promise.resolve(new Response("on: pull_request\njobs: {}", { status: 200 }))
      )
    );
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

  it("rejects unknown branch-review bypass allowance fields", async () => {
    const request = vi.fn((route: string) => {
      if (route === "GET /repos/{owner}/{repo}/branches/{branch}/protection") {
        return Promise.resolve(
          response({
            required_status_checks: null,
            enforce_admins: { enabled: true },
            required_pull_request_reviews: {
              required_approving_review_count: 1,
              bypass_pull_request_allowances: {
                users: [],
                teams: [],
                apps: [],
                enterprise_roles: []
              }
            },
            allow_force_pushes: { enabled: false },
            allow_deletions: { enabled: false }
          })
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected route"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getBranchProtection({
        owner: "octocat",
        repo: "demo",
        branch: "main"
      })
    ).rejects.toThrow("review-bypass-field-unsupported");
  });

  it("rejects a next link containing duplicate page parameters", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        if (params.page === 1) {
          return Promise.resolve(
            response([{ id: 7, name: "main" }], {
              link: '<https://api.github.com/repos/octocat/demo/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=2&page=999>; rel="next"'
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

  it("accepts ruleset pagination from the configured GitHub API base", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        if (params.page === 1) {
          return Promise.resolve(
            response([{ id: 7 }], {
              link: '<https://ghe.example/api/v3/repos/octocat/demo/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=2>; rel="next"'
            })
          );
        }
        return Promise.resolve(response([]));
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
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(request, undefined, "https://ghe.example/api/v3")
    );
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.listRulesets({ owner: "octocat", repo: "demo" })).resolves.toMatchObject([
      { id: 7 }
    ]);
    expect(request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/rulesets",
      expect.objectContaining({ page: 2 })
    );
  });

  it("waits for in-flight ruleset detail workers after one worker fails", async () => {
    let releaseBlockedWorker!: () => void;
    const blockedWorker = new Promise<void>((resolve) => {
      releaseBlockedWorker = resolve;
    });
    const request = vi.fn(async (route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(params.page === 1 ? response([{ id: 7 }, { id: 8 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        const requestOptions = params.request as {
          readonly fetch?: typeof globalThis.fetch;
        };
        if (typeof requestOptions.fetch !== "function") {
          throw new Error("bounded fetch was not passed");
        }
        if (params.ruleset_id === 7) {
          await requestOptions.fetch("https://api.github.com");
          throw Object.assign(new Error("detail failed"), { status: 500 });
        }
        await blockedWorker;
        await requestOptions.fetch("https://api.github.com");
        return response({
          id: 8,
          name: "second",
          target: "branch",
          enforcement: "active",
          conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
          bypass_actors: [],
          rules: []
        });
      }
      throw new Error("unexpected route");
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));
    const operation = createGitHubAuditClient("secret", {
      sleep: () => Promise.resolve()
    }).listRulesets({ owner: "octocat", repo: "demo" });
    const earlyResult = await Promise.race([
      operation.then(
        () => "settled",
        () => "settled"
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve("pending");
        }, 10);
      })
    ]);

    expect(earlyResult).toBe("pending");
    releaseBlockedWorker();
    await expect(operation).rejects.toThrow("request-failed");
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
    const request = vi.fn(async (route: string, params: Record<string, unknown>) => {
      const requestOptions = params.request as {
        readonly fetch?: typeof globalThis.fetch;
      };
      if (typeof requestOptions.fetch !== "function") {
        throw new Error("bounded fetch was not passed");
      }
      await requestOptions.fetch("https://api.github.com");
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return params.page === 1 ? response(summaries) : response([]);
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        const id = params.ruleset_id;
        return response({
          id,
          name: "ruleset-" + String(id),
          target: "branch",
          enforcement: "active",
          conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
          bypass_actors: [],
          rules: []
        });
      }
      throw Object.assign(new Error("unexpected"), { status: 500 });
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

    const undefinedData = vi.fn(() => Promise.resolve(response(undefined)));
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(undefinedData));
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

    const normalizedRateLimitRequest = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("rate limited"), {
          status: 403,
          response: { headers: { "x-ratelimit-remaining": " 0 ", "x-ratelimit-reset": "1" } }
        })
      )
      .mockResolvedValue(response({ default_branch: "main" }));
    const normalizedRateLimitSleep = vi.fn(() => Promise.resolve());
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(normalizedRateLimitRequest));
    await expect(
      createGitHubAuditClient("secret", {
        sleep: normalizedRateLimitSleep,
        now: () => 999
      }).getRepository({ owner: "octocat", repo: "demo" })
    ).resolves.toMatchObject({ defaultBranch: "main" });
    expect(normalizedRateLimitSleep).toHaveBeenCalledWith(1);

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

  it("does not retry when rate-limit headers are present but malformed", async () => {
    const request = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error("rate limited"), {
          status: 503,
          response: {
            headers: { "x-ratelimit-remaining": "not-a-number", "x-ratelimit-reset": "2" }
          }
        })
      )
    );
    const sleep = vi.fn(() => Promise.resolve());
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("request-failed");
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("honors Retry-After on structured non-success responses", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: { default_branch: "main" },
        headers: { "retry-after": "0.5" },
        status: 429
      })
      .mockResolvedValue(response({ default_branch: "main" }));
    const sleep = vi.fn(() => Promise.resolve());
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).resolves.toMatchObject({ defaultBranch: "main" });
    expect(sleep).toHaveBeenCalledWith(500);
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

    const blankRetryAfter = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("busy"), {
          status: 503,
          response: { headers: { "retry-after": "" } }
        })
      )
      .mockResolvedValue(response({ default_branch: "main" }));
    const blankRetrySleep = vi.fn(() => Promise.resolve());
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(blankRetryAfter));
    await expect(
      createGitHubAuditClient("secret", { sleep: blankRetrySleep }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("request-failed");
    expect(blankRetrySleep).not.toHaveBeenCalled();

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
      "",
      'rel="next"',
      '<not a url>; rel="next"',
      '<https://api.github.com/repos/octocat/demo/rulesets?page=bad>; rel="next"',
      '<https://api.github.com/repos/octocat/demo/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=2>; rel="next" trailing',
      '<https://api.github.com/repos/octocat/demo/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=2>; rel="next"; garbage',
      '<https://api.github.com/repos/octocat/demo/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=2>; rel="next", garbage'
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
            ...(params.page === 1 ? { link: '<https://api.github.com/next>; rel="other"' } : {})
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

  it("rejects unmodeled branch-protection semantics", async () => {
    const request = vi.fn((route: string) =>
      route.endsWith("/protection")
        ? Promise.resolve(
            response({
              required_status_checks: null,
              enforce_admins: { enabled: true },
              allow_force_pushes: { enabled: false },
              allow_deletions: { enabled: false },
              required_pull_request_reviews: null,
              required_conversation_resolution: { enabled: true }
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
    ).rejects.toThrow("branch-protection-semantics-unsupported");
  });

  it("rejects contradictory structured and legacy required-check fields", async () => {
    const request = vi.fn((route: string) =>
      route.endsWith("/protection")
        ? Promise.resolve(
            response({
              required_status_checks: {
                strict: true,
                checks: [{ context: "ReviewReady", app_id: 123 }],
                contexts: ["UnmodeledCheck"]
              },
              enforce_admins: { enabled: true },
              allow_force_pushes: { enabled: false },
              allow_deletions: { enabled: false },
              required_pull_request_reviews: null
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
    ).rejects.toThrow("required-checks-ambiguous");
  });

  it("rejects unknown nested branch-protection security fields", async () => {
    const request = vi.fn((route: string) =>
      route.endsWith("/protection")
        ? Promise.resolve(
            response({
              required_status_checks: null,
              enforce_admins: { enabled: true, security_semantics: false },
              allow_force_pushes: { enabled: false },
              allow_deletions: { enabled: false },
              required_pull_request_reviews: null
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
    ).rejects.toThrow("branch-protection-semantics-unsupported");
  });

  it("rejects conflicting check identity fields", async () => {
    const request = vi.fn((route: string) =>
      route.endsWith("/protection")
        ? Promise.resolve(
            response({
              required_status_checks: {
                strict: true,
                checks: [{ context: "ReviewReady", name: "Other", app_id: 123 }]
              },
              enforce_admins: { enabled: true },
              allow_force_pushes: { enabled: false },
              allow_deletions: { enabled: false },
              required_pull_request_reviews: null
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
    ).rejects.toThrow("required-checks-ambiguous");
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
                teams: [{ id: 2 }],
                apps: [{ id: 3 }]
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
          { id: "2", type: "team" },
          { id: "3", type: "app" }
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

  it("rejects branch-protection bypass actors without stable numeric IDs", async () => {
    const request = vi.fn((route: string) =>
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
                  users: [{ login: "alice" }],
                  teams: [{ slug: "release-team" }],
                  apps: [{ slug: "deploy-app" }]
                }
              }
            })
          )
        : Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }))
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getBranchProtection({
        owner: "octocat",
        repo: "demo",
        branch: "main"
      })
    ).rejects.toThrow("actor-identity-invalid");
  });

  it("rejects duplicate branch-protection bypass actor identities", async () => {
    const request = vi.fn((route: string) =>
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
                  users: [{ id: 1 }, { id: 1 }],
                  teams: [],
                  apps: []
                }
              }
            })
          )
        : Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }))
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getBranchProtection({
        owner: "octocat",
        repo: "demo",
        branch: "main"
      })
    ).rejects.toThrow("review-bypass-duplicate");
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
    vi.mocked(getOctokit).mockReturnValue(
      octokitWithTransport(invalidFile, undefined, undefined, { autoInvokeFetch: false })
    );
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getFileAtRevision({
        owner: "octocat",
        repo: "demo",
        path: ".reviewready.yml",
        ref: sha
      })
    ).rejects.toThrow("response-boundary-unavailable");

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
        response({
          owner: { login: "octocat", type: "Organization" },
          name: "demo",
          default_branch: "main",
          id: 0,
          visibility: "public"
        })
      )
    );
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(invalidInteger));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-integer-invalid");

    const invalidRulesetId = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(params.page === 1 ? response([{ id: 0 }]) : response([]));
      }
      return Promise.resolve(
        response({
          id: 0,
          name: "invalid-id",
          target: "branch",
          enforcement: "active",
          conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
          rules: [],
          bypass_actors: []
        })
      );
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(invalidRulesetId));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo",
        ownerType: "organization"
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
              { actor_type: "User", actor_id: 1, bypass_mode: "always" },
              { actor_type: "Team", actor_id: 2, bypass_mode: "exempt" },
              { actor_type: "Integration", actor_id: 3, bypass_mode: "pull_request" },
              { actor_type: "OrganizationAdmin", actor_id: null, bypass_mode: "always" },
              { actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "exempt" },
              { actor_type: "DeployKey", actor_id: null, bypass_mode: "always" }
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
        repo: "demo",
        ownerType: "organization"
      })
    ).resolves.toMatchObject([
      {
        bypassActors: [
          { id: "1", type: "user", actorType: "user", bypassMode: "always" },
          { id: "2", type: "team", actorType: "team", bypassMode: "exempt" },
          { id: "3", type: "integration", actorType: "integration", bypassMode: "pull_request" },
          {
            id: "organizationadmin",
            type: "app",
            actorType: "organization_admin",
            bypassMode: "always"
          },
          { id: "5", type: "app", actorType: "repository_role", bypassMode: "exempt" },
          { id: "deploykey", type: "app", actorType: "deploy_key", bypassMode: "always" }
        ]
      }
    ]);
  });

  it("rejects missing or aliased ruleset actor facts and duplicate identities", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(params.page === 1 ? response([{ id: 12 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 12,
            name: "invalid-actors",
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~ALL"] } },
            rules: [],
            bypass_actors: [{ actor_type: "User", actor_id: 1 }]
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
    ).rejects.toThrow("bypass-mode-invalid");

    const aliasedRequest = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(params.page === 1 ? response([{ id: 13 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 13,
            name: "aliased-actor",
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~ALL"] } },
            rules: [],
            bypass_actors: [{ actor_type: "user", actor_id: 1, bypass_mode: "always" }]
          })
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(aliasedRequest));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("actor-identity-invalid");

    const duplicateRequest = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(params.page === 1 ? response([{ id: 14 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 14,
            name: "duplicate-actor",
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~ALL"] } },
            rules: [],
            bypass_actors: [
              { actor_type: "User", actor_id: 1, bypass_mode: "always" },
              { actor_type: "User", actor_id: 1, bypass_mode: "exempt" }
            ]
          })
        );
      }
      return Promise.reject(Object.assign(new Error("unexpected"), { status: 500 }));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(duplicateRequest));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("ruleset-bypass-duplicate");
  });

  it("rejects an unsupported ruleset actor type", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(params.page === 1 ? response([{ id: 10 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 10,
            name: "unsupported-actor",
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~ALL"] } },
            bypass_actors: [{ actor_type: "Other", actor_id: 1 }],
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
    ).rejects.toThrow("actor-identity-invalid");
  });

  it("rejects an OrganizationAdmin actor with a missing actor ID field", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(params.page === 1 ? response([{ id: 11 }]) : response([]));
      }
      if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
        return Promise.resolve(
          response({
            id: 11,
            name: "missing-organization-admin-id",
            target: "branch",
            enforcement: "active",
            conditions: { ref_name: { include: ["~ALL"] } },
            bypass_actors: [{ actor_type: "OrganizationAdmin" }],
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
    ).rejects.toThrow("actor-identity-invalid");
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

    const multiRelation = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets" && params.page === 1) {
        return Promise.resolve(
          response([{ id: 1 }], {
            link: '<https://api.github.com/repos/octocat/demo/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=2>; rel="next last"'
          })
        );
      }
      return Promise.resolve(response([]));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(multiRelation));
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("pagination-link-ambiguous");

    const invalidNext = vi.fn(() =>
      Promise.resolve(
        response([{ id: 1 }], {
          link: '<https://api.github.com/repos/octocat/demo/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=3>; rel="next"'
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

  it("rejects a rel-last link that skips unlinked audit pages", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(
          response(
            [],
            params.page === 1
              ? {
                  link: '<https://api.github.com/repos/octocat/demo/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=5>; rel="last"'
                }
              : {}
          )
        );
      }
      return Promise.reject(new Error("unexpected"));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("rulesets-pagination-invalid");
  });

  it.each(["omitted", "changed"] as const)(
    "retains a declared rel-last page across %s audit continuations",
    async (scenario) => {
      const link = (page: number, relation: "next" | "last") =>
        `<https://api.github.com/repos/octocat/demo/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=${String(page)}>; rel="${relation}"`;
      const links =
        scenario === "omitted"
          ? new Map([
              [1, `${link(2, "next")}, ${link(5, "last")}`],
              [2, link(3, "next")],
              [3, link(4, "next")]
            ])
          : new Map([
              [1, `${link(2, "next")}, ${link(5, "last")}`],
              [2, `${link(3, "next")}, ${link(4, "last")}`],
              [3, link(4, "next")]
            ]);
      const request = vi.fn((route: string, params: Record<string, unknown>) => {
        if (route === "GET /repos/{owner}/{repo}/rulesets") {
          const page = params.page as number;
          const pageLink = links.get(page);
          return Promise.resolve(response([], pageLink === undefined ? {} : { link: pageLink }));
        }
        return Promise.reject(new Error("unexpected"));
      });
      vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

      await expect(
        createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
          owner: "octocat",
          repo: "demo"
        })
      ).rejects.toThrow("rulesets-pagination-invalid");
    }
  );

  it("rejects a valid next link mixed with a malformed next relation", async () => {
    const request = vi.fn((route: string, params: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}/rulesets") {
        return Promise.resolve(
          response(params.page === 1 ? [{ id: 1 }] : [], {
            link: '<https://api.github.com/repos/octocat/demo/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=2>; rel="next", rel=next'
          })
        );
      }
      return Promise.reject(new Error("unexpected"));
    });
    vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("pagination-link-invalid");
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
              link: '<https://api.github.com/repos/octocat/demo/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=2>; rel="next"'
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
                  link: `<https://api.github.com/repos/octocat/demo/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=${String(
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
