const SHA = /^[0-9a-f]{40}$/iu;

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

export function withDeadline<T>(
  operation: PromiseLike<T>,
  milliseconds: number,
  onTimeout?: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // The deadline failure remains the stable public outcome.
      }
      reject(new AuditApiFailure("audit-deadline-exceeded"));
    }, milliseconds);
    Promise.resolve(operation).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new AuditApiFailure("response-error-invalid"));
      }
    );
  });
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AuditApiFailure("response-object-invalid");
  }
  return value as Record<string, unknown>;
}

export function stringField(value: unknown, max = 512): string {
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

export function shaField(value: unknown): string {
  const candidate = stringField(value, 128);
  if (!SHA.test(candidate)) {
    throw new AuditApiFailure("response-sha-invalid");
  }
  return candidate;
}

export function booleanField(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new AuditApiFailure("response-boolean-invalid");
  }
  return value;
}

export function integerField(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new AuditApiFailure("response-integer-invalid");
  }
  return value as number;
}

export function appIdField(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 2_147_483_647) {
    throw new AuditApiFailure("response-app-id-invalid");
  }
  return value as number;
}
