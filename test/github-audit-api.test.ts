import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOctokit } from "@actions/github";

import { createGitHubAuditClient } from "../src/github-audit-api.js";

vi.mock("@actions/github", () => ({ getOctokit: vi.fn() }));

const sha = "a".repeat(40);

function response(data: unknown, headers: Record<string, string> = {}) {
  return { data, headers, status: 200 };
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
        targets: "branch,tag,push",
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

  it("maps read-only GitHub responses into the collector contract", async () => {
    const request = fakeRequest();
    vi.mocked(getOctokit).mockReturnValue({ request } as never);
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).resolves.toEqual({
      owner: "octocat",
      name: "demo",
      defaultBranch: "main"
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
    vi.mocked(getOctokit).mockReturnValue({ request } as never);
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
    vi.mocked(getOctokit).mockReturnValue({ request } as never);
    const sleep = vi.fn(() => Promise.resolve());
    const client = createGitHubAuditClient("secret", { sleep });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).resolves.toMatchObject({
      defaultBranch: "main"
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
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
    vi.mocked(getOctokit).mockReturnValue({ request } as never);
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(
      client.getBranchProtection({ owner: "octocat", repo: "demo", branch: "main" })
    ).resolves.toBeNull();
  });

  it("rejects an oversized response before mapping untrusted API data", async () => {
    const request = vi.fn(() =>
      Promise.resolve(
        response({ default_branch: "main" }, { "content-length": String(3 * 1024 * 1024) })
      )
    );
    vi.mocked(getOctokit).mockReturnValue({ request } as never);
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
      "response-size-limit"
    );
  });

  it("does not start a retry after the overall collection deadline", async () => {
    let currentTime = 0;
    const request = vi.fn(() => Promise.reject(Object.assign(new Error("busy"), { status: 503 })));
    vi.mocked(getOctokit).mockReturnValue({ request } as never);
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
    vi.mocked(getOctokit).mockReturnValue({ request } as never);
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
    vi.mocked(getOctokit).mockReturnValue({ request } as never);
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
    vi.mocked(getOctokit).mockReturnValue({ request } as never);
    const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });

    await expect(client.listRulesets({ owner: "octocat", repo: "demo" })).resolves.toMatchObject([
      { repositoryPatterns: ["other-owner/other-repository"] }
    ]);
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
      vi.mocked(getOctokit).mockReturnValue({ request } as never);
      const client = createGitHubAuditClient("secret", { sleep: () => Promise.resolve() });
      await expect(client.getRepository({ owner: "octocat", repo: "demo" })).rejects.toThrow(
        data === null || Array.isArray(data) ? "response-object-invalid" : "response-string-invalid"
      );
    }

    const invalidBranch = vi.fn(() =>
      Promise.resolve(response({ name: "main", commit: { sha: "not-a-sha" } }))
    );
    vi.mocked(getOctokit).mockReturnValue({ request: invalidBranch } as never);
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
      vi.mocked(getOctokit).mockReturnValue({ request } as never);
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
    vi.mocked(getOctokit).mockReturnValue({ request: huge } as never);
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-size-limit");

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const circularRequest = vi.fn(() => Promise.resolve(response(circular)));
    vi.mocked(getOctokit).mockReturnValue({ request: circularRequest } as never);
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("response-data-invalid");

    const conditional = vi.fn(() => Promise.resolve({ data: {}, headers: {}, status: 304 }));
    vi.mocked(getOctokit).mockReturnValue({ request: conditional } as never);
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("conditional-response-without-body");

    const permanent = vi.fn(() =>
      Promise.reject(Object.assign(new Error("denied"), { status: 400 }))
    );
    vi.mocked(getOctokit).mockReturnValue({ request: permanent } as never);
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("request-failed");
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
    vi.mocked(getOctokit).mockReturnValue({ request: retryAfterRequest } as never);
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
    vi.mocked(getOctokit).mockReturnValue({ request: rateLimitRequest } as never);
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
    vi.mocked(getOctokit).mockReturnValue({ request: invalidRetryAfter } as never);
    await expect(
      createGitHubAuditClient("secret", { sleep: invalidRetrySleep }).getRepository({
        owner: "octocat",
        repo: "demo"
      })
    ).resolves.toMatchObject({ defaultBranch: "main" });
    expect(invalidRetrySleep).toHaveBeenCalledWith(100);
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
                users: [{ id: "1" }],
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
    vi.mocked(getOctokit).mockReturnValue({ request } as never);
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
    vi.mocked(getOctokit).mockReturnValue({ request: nullReviews } as never);
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
      vi.mocked(getOctokit).mockReturnValue({ request } as never);
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
    vi.mocked(getOctokit).mockReturnValue({ request: invalidRuleset } as never);
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("ruleset-target-invalid");

    const invalidWorkflow = vi.fn(() =>
      Promise.resolve(response([{ path: ".github/workflows/bad.yml", type: "socket" }]))
    );
    vi.mocked(getOctokit).mockReturnValue({ request: invalidWorkflow } as never);
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listWorkflowFiles({
        owner: "octocat",
        repo: "demo",
        ref: sha
      })
    ).rejects.toThrow("workflow-entry-type-invalid");

    const invalidFile = vi.fn(() => Promise.resolve(response({ content: "not raw text" })));
    vi.mocked(getOctokit).mockReturnValue({ request: invalidFile } as never);
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getFileAtRevision({
        owner: "octocat",
        repo: "demo",
        path: ".reviewready.yml",
        ref: sha
      })
    ).rejects.toThrow("file-content-invalid");

    const invalidTags = vi.fn(() => Promise.resolve(response({ pattern: "*" })));
    vi.mocked(getOctokit).mockReturnValue({ request: invalidTags } as never);
    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).getTagProtection({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("tag-protection-invalid");
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
    vi.mocked(getOctokit).mockReturnValue({ request: ambiguousLink } as never);
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
    vi.mocked(getOctokit).mockReturnValue({ request: invalidNext } as never);
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
    vi.mocked(getOctokit).mockReturnValue({ request } as never);

    await expect(
      createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
        owner: "octocat",
        repo: "demo"
      })
    ).rejects.toThrow("rulesets-pagination-ambiguous");
  });

  it("normalizes workflow extensions and tag protection patterns", async () => {
    const request = vi.fn((route: string) => {
      if (route === "GET /repos/{owner}/{repo}/contents/.github/workflows") {
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
    vi.mocked(getOctokit).mockReturnValue({ request } as never);
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
