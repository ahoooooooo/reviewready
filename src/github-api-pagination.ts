import type { GitHubCheckRun } from "./github.js";
import { headerValue, incompleteEvidence, INVALID_HEADER_VALUE } from "./github-api-boundaries.js";

export const CHECK_RUN_PAGE_SIZE = 100;
export const MAX_CHECK_RUNS = 1000;

async function collectPages<T>(
  fetchPage: (page: number) => Promise<readonly T[]>,
  pageSize: number,
  maxItems: number,
  kind: string
): Promise<T[]> {
  const result: T[] = [];
  for (let page = 1; ; page += 1) {
    const items = await fetchPage(page);
    if (items.length > pageSize || result.length + items.length > maxItems) {
      throw incompleteEvidence(kind, maxItems);
    }
    result.push(...items);
    if (result.length >= maxItems) {
      throw incompleteEvidence(kind, maxItems);
    }
    if (items.length < pageSize) {
      return result;
    }
  }
}

interface ApiPage<T> {
  readonly items: readonly T[];
  readonly hasNext: boolean;
  readonly nextPage?: number | undefined;
  readonly hasLast?: boolean | undefined;
  readonly lastPage?: number | undefined;
}

interface NextPageLink {
  readonly hasNext: boolean;
  readonly nextPage?: number | undefined;
  readonly hasLast?: boolean | undefined;
  readonly lastPage?: number | undefined;
}

function linkedPageNumber(url: string): { readonly valid: boolean; readonly page?: number } {
  try {
    const searchParams = new URL(url).searchParams;
    const pageValues = searchParams.getAll("page");
    if (pageValues.length === 0) {
      return { valid: true };
    }
    if (pageValues.length !== 1) {
      return { valid: false };
    }
    const rawPage = pageValues[0];
    if (rawPage === undefined) {
      return { valid: false };
    }
    if (!/^[1-9][0-9]*$/u.test(rawPage)) {
      return { valid: false };
    }
    const page = Number(rawPage);
    return Number.isSafeInteger(page) ? { valid: true, page } : { valid: false };
  } catch {
    return { valid: false };
  }
}

export function nextPageLink(headers: unknown): NextPageLink {
  if (headers === undefined) {
    return { hasNext: false };
  }
  if (typeof headers !== "object" || headers === null) {
    return { hasNext: true };
  }
  const link = headerValue(headers, "link");
  if (link === INVALID_HEADER_VALUE) {
    return { hasNext: true };
  }
  if (link === undefined) {
    return { hasNext: false };
  }
  if (typeof link !== "string") {
    return { hasNext: true };
  }
  if (link.trim() === "") {
    return { hasNext: true };
  }
  const entries = [
    ...link.matchAll(/<([^<>]+)>\s*;\s*rel=(?:"([^"]*)"|'([^']*)')(?=\s*(?:,|$))/giu)
  ];
  let offset = 0;
  for (const entry of entries) {
    const start = entry.index;
    if (link.slice(offset, start).trim() !== (offset === 0 ? "" : ",")) {
      return { hasNext: true };
    }
    offset = start + entry[0].length;
  }
  if (entries.length === 0 || link.slice(offset).trim() !== "") {
    return { hasNext: true };
  }
  const relations = entries.map((entry) => entry[2] ?? entry[3]);
  if (
    relations.some(
      (relation) => relation === undefined || relation.trim() === "" || /\s/u.test(relation)
    )
  ) {
    return { hasNext: true };
  }
  const nextEntries = entries.filter((entry) => (entry[2] ?? entry[3])?.toLowerCase() === "next");
  const lastEntries = entries.filter((entry) => (entry[2] ?? entry[3])?.toLowerCase() === "last");
  if (nextEntries.length === 0) {
    if (lastEntries.length > 1) {
      return { hasNext: true };
    }
    if (lastEntries.length === 0) {
      return { hasNext: false };
    }
    const lastEntry = lastEntries[0];
    const lastUrl = lastEntry?.[1];
    if (lastUrl === undefined) {
      return { hasNext: true };
    }
    const last = linkedPageNumber(lastUrl);
    if (!last.valid) {
      return { hasNext: true };
    }
    return {
      hasNext: false,
      hasLast: true,
      ...(last.page === undefined ? {} : { lastPage: last.page })
    };
  }
  if (nextEntries.length !== 1) {
    return { hasNext: true };
  }
  const nextEntry = nextEntries[0];
  const nextUrl = nextEntry?.[1];
  if (nextUrl === undefined) {
    return { hasNext: true };
  }

  const next = linkedPageNumber(nextUrl);
  if (!next.valid) {
    return { hasNext: true };
  }
  if (lastEntries.length > 1) {
    return { hasNext: true };
  }
  if (lastEntries.length === 0) {
    return { hasNext: true, ...(next.page === undefined ? {} : { nextPage: next.page }) };
  }
  const lastEntry = lastEntries[0];
  const lastUrl = lastEntry?.[1];
  if (lastUrl === undefined) {
    return { hasNext: true };
  }
  const last = linkedPageNumber(lastUrl);
  if (!last.valid) {
    return { hasNext: true };
  }
  return {
    hasNext: true,
    ...(next.page === undefined ? {} : { nextPage: next.page }),
    hasLast: true,
    ...(last.page === undefined ? {} : { lastPage: last.page })
  };
}

export async function collectApiPages<T>(
  fetchPage: (page: number) => Promise<ApiPage<T>>,
  pageSize: number,
  maxItems: number,
  kind: string
): Promise<T[]> {
  const result: T[] = [];
  const maxPages = maxItems / pageSize;
  let declaredLastPage: number | undefined;
  for (let page = 1; page <= maxPages; page += 1) {
    const pageResult = await fetchPage(page);
    const items = pageResult.items;
    if (items.length > pageSize || result.length + items.length > maxItems) {
      throw incompleteEvidence(kind, maxItems);
    }
    result.push(...items);
    if (result.length >= maxItems) {
      throw incompleteEvidence(kind, maxItems);
    }

    if (pageResult.hasLast) {
      if (pageResult.lastPage === undefined) {
        throw incompleteEvidence(kind, maxItems);
      }
      if (declaredLastPage !== undefined && pageResult.lastPage !== declaredLastPage) {
        throw incompleteEvidence(kind, maxItems);
      }
      declaredLastPage = pageResult.lastPage;
    } else if (declaredLastPage !== undefined && page < declaredLastPage) {
      throw incompleteEvidence(kind, maxItems);
    }

    if (pageResult.hasNext) {
      if (
        pageResult.nextPage !== page + 1 ||
        (declaredLastPage !== undefined && declaredLastPage < page + 1)
      ) {
        throw incompleteEvidence(kind, maxItems);
      }
      if (page === maxPages) {
        throw incompleteEvidence(kind, maxItems);
      }
      continue;
    }
    if (declaredLastPage !== undefined && declaredLastPage !== page) {
      throw incompleteEvidence(kind, maxItems);
    }
    if (items.length < pageSize) {
      const extraPage = await fetchPage(page + 1);
      const validEmptyExtraPage =
        extraPage.items.length === 0 &&
        !extraPage.hasNext &&
        extraPage.nextPage === undefined &&
        (!extraPage.hasLast || extraPage.lastPage === page);
      if (!validEmptyExtraPage) {
        throw incompleteEvidence(kind, maxItems);
      }
      return result;
    }

    const extraPage = await fetchPage(page + 1);
    const validEmptyExtraPage =
      extraPage.items.length === 0 &&
      !extraPage.hasNext &&
      extraPage.nextPage === undefined &&
      (!extraPage.hasLast || extraPage.lastPage === page);
    if (!validEmptyExtraPage) {
      throw incompleteEvidence(kind, maxItems);
    }
    return result;
  }
  return result;
}

export async function collectCheckRunPages(
  fetchPage: (page: number) => Promise<readonly GitHubCheckRun[]>
): Promise<GitHubCheckRun[]> {
  return collectPages(fetchPage, CHECK_RUN_PAGE_SIZE, MAX_CHECK_RUNS, "check runs");
}
