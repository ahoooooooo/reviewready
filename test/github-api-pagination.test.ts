import { describe, expect, it } from "vitest";

import { collectApiPages, nextPageLink } from "../src/github-api-pagination.js";

const incomplete = {
  code: "GITHUB_EVIDENCE_INCOMPLETE",
  kind: "platform"
};

describe("GitHub API Link parsing", () => {
  it.each([
    [undefined, { hasNext: false }],
    [null, { hasNext: true }],
    [{}, { hasNext: false }],
    [{ link: "" }, { hasNext: true }],
    [{ link: 7 }, { hasNext: true }],
    [{ Link: "<https://api.github.test?page=2>; rel='next'" }, { hasNext: true, nextPage: 2 }],
    [
      { link: '<https://api.github.test?page=1>; rel="last"' },
      { hasNext: false, hasLast: true, lastPage: 1 }
    ],
    [{ link: '<https://api.github.test>; rel="last"' }, { hasNext: false, hasLast: true }],
    [{ link: '<https://api.github.test>; rel="next"' }, { hasNext: true }],
    [{ link: '<https://api.github.test?page=0>; rel="next"' }, { hasNext: true }],
    [{ link: '<https://api.github.test?page=2&page=3>; rel="next"' }, { hasNext: true }],
    [{ link: '<not a URL>; rel="next"' }, { hasNext: true }],
    [
      { link: '<https://api.github.test?page=999999999999999999999>; rel="next"' },
      { hasNext: true }
    ],
    [{ link: '<https://api.github.test?page=2>; rel="next last"' }, { hasNext: true }],
    [{ link: '<https://api.github.test?page=2>; rel="next" trailing' }, { hasNext: true }]
  ])("maps bounded Link metadata without guessing continuation", (headers, expected) => {
    expect(nextPageLink(headers)).toEqual(expected);
  });

  it("rejects duplicated case-insensitive Link headers", () => {
    expect(
      nextPageLink({
        link: '<https://api.github.test?page=2>; rel="next"',
        Link: '<https://api.github.test?page=3>; rel="next"'
      })
    ).toEqual({ hasNext: true });
  });
});

describe("GitHub API page collection", () => {
  it("accepts contiguous pages and one canonical empty probe", async () => {
    await expect(
      collectApiPages(
        (page) => {
          if (page === 1) {
            return Promise.resolve({
              items: [1, 2],
              hasNext: true,
              nextPage: 2,
              hasLast: true,
              lastPage: 2
            });
          }
          if (page === 2) {
            return Promise.resolve({
              items: [3],
              hasNext: false,
              hasLast: true,
              lastPage: 2
            });
          }
          return Promise.resolve({ items: [], hasNext: false, hasLast: true, lastPage: 2 });
        },
        2,
        6,
        "fixture"
      )
    ).resolves.toEqual([1, 2, 3]);
  });

  it("accepts a full terminal page only after an empty probe", async () => {
    await expect(
      collectApiPages(
        (page) => Promise.resolve({ items: page === 1 ? [1] : [], hasNext: false }),
        1,
        2,
        "fixture"
      )
    ).resolves.toEqual([1]);
  });

  it.each([
    {
      name: "oversized page",
      pageSize: 2,
      maxItems: 4,
      fetchPage: () => Promise.resolve({ items: [1, 2, 3], hasNext: false })
    },
    {
      name: "exact item limit",
      pageSize: 2,
      maxItems: 2,
      fetchPage: () => Promise.resolve({ items: [1, 2], hasNext: false })
    },
    {
      name: "declared last page without a number",
      pageSize: 2,
      maxItems: 4,
      fetchPage: () => Promise.resolve({ items: [1], hasNext: false, hasLast: true })
    },
    {
      name: "changed declared last page",
      pageSize: 1,
      maxItems: 4,
      fetchPage: (page: number) =>
        Promise.resolve(
          page === 1
            ? { items: [1], hasNext: true, nextPage: 2, hasLast: true, lastPage: 3 }
            : { items: [], hasNext: false, hasLast: true, lastPage: 4 }
        )
    },
    {
      name: "dropped declared last page",
      pageSize: 1,
      maxItems: 4,
      fetchPage: (page: number) =>
        Promise.resolve(
          page === 1
            ? { items: [1], hasNext: true, nextPage: 2, hasLast: true, lastPage: 3 }
            : { items: [], hasNext: false }
        )
    },
    {
      name: "non-contiguous next page",
      pageSize: 2,
      maxItems: 4,
      fetchPage: () => Promise.resolve({ items: [1], hasNext: true, nextPage: 3 })
    },
    {
      name: "next page beyond declared last page",
      pageSize: 2,
      maxItems: 4,
      fetchPage: () =>
        Promise.resolve({
          items: [1],
          hasNext: true,
          nextPage: 2,
          hasLast: true,
          lastPage: 1
        })
    },
    {
      name: "continuation at the page budget",
      pageSize: 1,
      maxItems: 2,
      fetchPage: (page: number) =>
        Promise.resolve(
          page === 1
            ? { items: [1], hasNext: true, nextPage: 2 }
            : { items: [], hasNext: true, nextPage: 3 }
        )
    },
    {
      name: "terminal page before declared last page",
      pageSize: 2,
      maxItems: 4,
      fetchPage: () =>
        Promise.resolve({
          items: [1],
          hasNext: false,
          hasLast: true,
          lastPage: 2
        })
    },
    {
      name: "non-empty probe after a partial page",
      pageSize: 2,
      maxItems: 4,
      fetchPage: (page: number) =>
        Promise.resolve({
          items: page === 1 ? [1] : [2],
          hasNext: false
        })
    },
    {
      name: "non-empty probe after a full page",
      pageSize: 1,
      maxItems: 2,
      fetchPage: (page: number) =>
        Promise.resolve({
          items: page === 1 ? [1] : [2],
          hasNext: false
        })
    }
  ])("fails closed for $name", async ({ fetchPage, pageSize, maxItems }) => {
    await expect(collectApiPages(fetchPage, pageSize, maxItems, "fixture")).rejects.toMatchObject(
      incomplete
    );
  });

  it("returns an empty result when the caller supplies no page budget", async () => {
    const fetchPage = (): Promise<{ items: number[]; hasNext: false }> =>
      Promise.resolve({
        items: [],
        hasNext: false
      });

    await expect(collectApiPages(fetchPage, 1, 0, "fixture")).resolves.toEqual([]);
  });
});
