import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PackageScriptPort, ScriptManifest } from "./verificationContracts.js";

export type ReadTextFile = (path: string) => string;

const isFileNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { readonly code?: unknown }).code === "ENOENT";

const defaultReadText: ReadTextFile = (path) => readFileSync(path, "utf8");

export class NodePackageScriptPort implements PackageScriptPort {
  public constructor(
    private readonly rootPath: string,
    private readonly readText: ReadTextFile = defaultReadText,
  ) {}

  public scripts(): ScriptManifest {
    let raw: string;
    try {
      raw = this.readText(join(this.rootPath, "package.json"));
    } catch (error) {
      // A genuinely absent root manifest is distinct from one that exists but
      // cannot be read; only the former is a "no script here" condition.
      return isFileNotFound(error) ? { status: "absent" } : { status: "unreadable" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: "unreadable" };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { status: "unreadable" };
    }

    const scripts = (parsed as { readonly scripts?: unknown }).scripts;
    if (scripts === undefined) {
      return { status: "ok", scripts: {} };
    }
    if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
      return { status: "unreadable" };
    }
    return { status: "ok", scripts: scripts as Record<string, string> };
  }
}
