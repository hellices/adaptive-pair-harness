import { lstat, realpath, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export const filesystemErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
};

const isMissingPathError = (error: unknown): boolean => {
  const code = filesystemErrorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
};

export const scopePathIdentity = async (absolute: string, signal: AbortSignal): Promise<string> => {
  let ancestor = absolute;
  const missingSuffix: string[] = [];
  while (true) {
    signal.throwIfAborted();
    let identity: string;
    try {
      identity = await realpath(ancestor);
    } catch (error) {
      signal.throwIfAborted();
      if (!isMissingPathError(error)) {
        throw error;
      }
      let missing = false;
      try {
        await lstat(ancestor);
      } catch (inspectionError) {
        signal.throwIfAborted();
        if (!isMissingPathError(inspectionError)) {
          throw inspectionError;
        }
        missing = true;
      }
      signal.throwIfAborted();
      const parent = dirname(ancestor);
      if (!missing || parent === ancestor) {
        throw error;
      }
      missingSuffix.push(basename(ancestor));
      ancestor = parent;
      continue;
    }
    signal.throwIfAborted();
    if (missingSuffix.length > 0) {
      const existing = await stat(identity);
      signal.throwIfAborted();
      if (!existing.isDirectory()) {
        throw Object.assign(
          new Error("The existing scope ancestor is not a directory."),
          { code: "ENOTDIR" },
        );
      }
    }
    return resolve(identity, ...missingSuffix.reverse());
  }
};
