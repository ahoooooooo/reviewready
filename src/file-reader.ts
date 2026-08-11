import { lstat, open, type FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";

export const MAX_CLI_FILE_BYTES = 4 * 1024 * 1024;

export type FileReadFailure =
  "not_found" | "access_denied" | "not_regular" | "too_large" | "read_failed";

export class CliFileError extends Error {
  public override readonly name = "CliFileError";

  public constructor(public readonly reason: FileReadFailure) {
    super("CLI file could not be read.");
  }
}

export function classifyFileSystemError(error: unknown): FileReadFailure {
  if (typeof error !== "object" || error === null) {
    return "read_failed";
  }

  const code = (error as NodeJS.ErrnoException).code;
  switch (code) {
    case "ENOENT":
    case "ENOTDIR":
      return "not_found";
    case "EACCES":
    case "EPERM":
      return "access_denied";
    case "EISDIR":
    case "ELOOP":
    case "ENODEV":
    case "ENXIO":
      return "not_regular";
    case "EFBIG":
    case "EOVERFLOW":
    case "ERR_FS_FILE_TOO_LARGE":
      return "too_large";
    default:
      return "read_failed";
  }
}

export function classifyFileReadFailure(error: unknown): FileReadFailure {
  return error instanceof CliFileError ? error.reason : classifyFileSystemError(error);
}

function ensureValidLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer.");
  }
}

function sameFileIdentity(first: Stats, second: Stats): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

export async function readBoundedFile(
  path: string,
  maxBytes = MAX_CLI_FILE_BYTES
): Promise<string> {
  ensureValidLimit(maxBytes);

  let handle: FileHandle | undefined;
  try {
    const linkStats = await lstat(path);
    if (!linkStats.isFile()) {
      throw new CliFileError("not_regular");
    }
    if (linkStats.size > maxBytes) {
      throw new CliFileError("too_large");
    }

    handle = await open(path, "r");
    const openedStats = await handle.stat();
    if (!openedStats.isFile()) {
      throw new CliFileError("not_regular");
    }
    if (!sameFileIdentity(linkStats, openedStats)) {
      throw new CliFileError("not_regular");
    }
    if (openedStats.size > maxBytes) {
      throw new CliFileError("too_large");
    }

    const currentStats = await lstat(path);
    if (!currentStats.isFile()) {
      throw new CliFileError("not_regular");
    }
    if (!sameFileIdentity(openedStats, currentStats)) {
      throw new CliFileError("not_regular");
    }
    if (currentStats.size > maxBytes) {
      throw new CliFileError("too_large");
    }

    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let bytesRead = 0;
    while (bytesRead <= maxBytes) {
      const result = await handle.read(buffer, bytesRead, maxBytes + 1 - bytesRead, null);
      if (result.bytesRead === 0) {
        break;
      }
      bytesRead += result.bytesRead;
    }

    if (bytesRead > maxBytes) {
      throw new CliFileError("too_large");
    }
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch (error) {
    if (error instanceof CliFileError) {
      throw error;
    }
    throw new CliFileError(classifyFileSystemError(error));
  } finally {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
  }
}
