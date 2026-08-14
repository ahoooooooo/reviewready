import { getOctokit } from "@actions/github";
import { expect, it, vi } from "vitest";

import { createGitHubAuditClient } from "../src/github-audit-api.js";

vi.mock("@actions/github", () => ({ getOctokit: vi.fn() }));

function response(data: unknown, headers: Record<string, string> = {}) {
  return { data, headers, status: 200 };
}

function octokitWithTransport(request: unknown): never {
  const callable = request as ((...arguments_: never[]) => unknown) & {
    readonly endpoint?: unknown;
    readonly defaults?: unknown;
  };
  Object.assign(callable, {
    endpoint: {
      DEFAULTS: {
        baseUrl: "https://api.github.com",
        request: { fetch: () => Promise.resolve(new Response("", { status: 200 })) }
      }
    },
    defaults: () => request
  });
  return { request: callable } as never;
}

it("accepts GitHub's repository-id ruleset pagination link", async () => {
  const request = vi.fn((route: string, params: Record<string, unknown>) => {
    if (route === "GET /repos/{owner}/{repo}/rulesets") {
      return Promise.resolve(
        response(
          params.page === 1 ? [{ id: 7 }] : [],
          params.page === 1
            ? {
                link: '<https://api.github.com/repositories/123/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=2>; rel="next"'
              }
            : {}
        )
      );
    }
    if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
      return Promise.resolve(
        response({
          id: 7,
          name: "main",
          target: "branch",
          enforcement: "active",
          current_user_can_bypass: "never",
          conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
          bypass_actors: [],
          rules: []
        })
      );
    }
    return Promise.reject(new Error("unexpected"));
  });
  vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

  await expect(
    createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
      owner: "octocat",
      repo: "demo",
      ownerType: "organization",
      repositoryId: 123
    })
  ).resolves.toMatchObject([{ id: 7, name: "main" }]);
});

it("accepts an empty continuation whose last page is the current page", async () => {
  const request = vi.fn((route: string, params: Record<string, unknown>) => {
    if (route === "GET /repos/{owner}/{repo}/rulesets") {
      return Promise.resolve(
        response(
          params.page === 1 ? [{ id: 7 }] : [],
          params.page === 2
            ? {
                link: '<https://api.github.com/repositories/123/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=1>; rel="prev", <https://api.github.com/repositories/123/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=1>; rel="last", <https://api.github.com/repositories/123/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=1>; rel="first"'
              }
            : {}
        )
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
          rules: []
        })
      );
    }
    return Promise.reject(new Error("unexpected"));
  });
  vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

  await expect(
    createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
      owner: "octocat",
      repo: "demo",
      ownerType: "organization",
      repositoryId: 123
    })
  ).resolves.toMatchObject([{ id: 7, name: "main" }]);
});

it("rejects ruleset responses that grant the caller bypass capability", async () => {
  const request = vi.fn((route: string, params: Record<string, unknown>) => {
    if (route === "GET /repos/{owner}/{repo}/rulesets") {
      return Promise.resolve(
        response(
          params.page === 1 ? [{ id: 7 }] : [],
          params.page === 1
            ? {
                link: '<https://api.github.com/repositories/123/rulesets?includes_parents=true&targets=branch%2Ctag%2Cpush%2Crepository&per_page=100&page=2>; rel="next"'
              }
            : {}
        )
      );
    }
    if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
      return Promise.resolve(
        response({
          id: 7,
          name: "main",
          target: "branch",
          enforcement: "active",
          current_user_can_bypass: "always",
          conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
          bypass_actors: [],
          rules: []
        })
      );
    }
    return Promise.reject(new Error("unexpected"));
  });
  vi.mocked(getOctokit).mockReturnValue(octokitWithTransport(request));

  await expect(
    createGitHubAuditClient("secret", { sleep: () => Promise.resolve() }).listRulesets({
      owner: "octocat",
      repo: "demo",
      ownerType: "organization",
      repositoryId: 123
    })
  ).rejects.toThrow("ruleset-bypass-semantics-unsupported");
});
