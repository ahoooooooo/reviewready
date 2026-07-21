export abstract class ReviewReadyError extends Error {
  public abstract readonly kind: "policy" | "input" | "platform";
  public readonly exitCode = 2;

  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
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
