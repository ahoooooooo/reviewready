export function escapeControlCharacters(value: string): string {
  // Control ranges are rendered as literal data at every public error boundary.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Format}]/gu, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return "\\u" + codePoint.toString(16).padStart(4, "0");
  });
}

export abstract class ReviewReadyError extends Error {
  public abstract readonly kind: "policy" | "input" | "platform";
  public readonly exitCode = 2;

  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(escapeControlCharacters(message), options);
    this.name = new.target.name;
  }
}

export class PolicyError extends ReviewReadyError {
  public readonly kind = "policy" as const;
}

export class InputError extends ReviewReadyError {
  public readonly kind = "input" as const;
}

export class PlatformError extends ReviewReadyError {
  public readonly kind = "platform" as const;
}
