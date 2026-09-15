// A reliable "is this module the process entry point?" check for the release
// scripts.
//
// The naive `import.meta.url === `file://${process.argv[1]}`` comparison fails
// open: it silently evaluates to false — so the script does nothing and exits 0
// — whenever the checkout path contains a space or a non-ASCII character (the
// URL is percent-encoded), whenever the entry is reached through a symlink
// (Node reports the real path in `import.meta.url`), and always on Windows
// (`file://C:\...` is never the URL Node produces). Comparing decoded, resolved
// filesystem paths instead makes the guard fail closed.
import { realpathSync } from "node:fs";
import { posix as posixPath, win32 as win32Path } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {object} MainModuleOptions
 * @property {string} [platform] defaults to `process.platform`
 * @property {string} [cwd] defaults to `process.cwd()`
 * @property {(path: string) => string} [realpath] defaults to a non-throwing
 *   `realpathSync`; injected by tests so hypothetical paths need no filesystem
 */

/**
 * @param {string | undefined} platform
 * @returns {boolean}
 */
const isWindows = (platform) => (platform ?? process.platform) === "win32";

/**
 * @param {string | undefined} platform
 * @returns {import("node:path").PlatformPath}
 */
const pathApi = (platform) => (isWindows(platform) ? win32Path : posixPath);

/** @param {string} path */
const safeRealpath = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/**
 * Reduce a path to the form used for comparison: normalized separators, no
 * trailing separator, and case-folded where the platform is case-insensitive.
 *
 * @param {string} value
 * @param {string | undefined} platform
 * @returns {string}
 */
export const comparablePath = (value, platform) => {
  const api = pathApi(platform);
  let normalized = api.normalize(value);
  while (normalized.length > 1 && normalized.endsWith(api.sep)) {
    normalized = normalized.slice(0, -1);
  }
  return isWindows(platform) ? normalized.toLowerCase() : normalized;
};

/**
 * The decoded filesystem path of a module URL, or `undefined` when the module
 * was not loaded from a file (for example a `data:` URL).
 *
 * @param {string} moduleUrl
 * @param {string} [platform]
 * @returns {string | undefined}
 */
export const modulePathFromUrl = (moduleUrl, platform) => {
  try {
    return fileURLToPath(moduleUrl, { windows: isWindows(platform) });
  } catch {
    return undefined;
  }
};

/**
 * The absolute filesystem path of the process entry point, accepting an
 * absolute path, a path relative to the working directory, or a file URL.
 *
 * @param {string | undefined} argv1
 * @param {MainModuleOptions} [options]
 * @returns {string | undefined}
 */
export const entryPathFromArgv = (argv1, options = {}) => {
  if (typeof argv1 !== "string" || argv1.length === 0) {
    return undefined;
  }

  const platform = options.platform;
  if (argv1.startsWith("file://")) {
    return modulePathFromUrl(argv1, platform);
  }

  const api = pathApi(platform);
  if (api.isAbsolute(argv1)) {
    return argv1;
  }
  return api.resolve(options.cwd ?? process.cwd(), argv1);
};

/**
 * True when `moduleUrl` names the file Node was asked to execute.
 *
 * @param {string} moduleUrl pass `import.meta.url`
 * @param {string | undefined} [argv1] defaults to `process.argv[1]`
 * @param {MainModuleOptions} [options]
 * @returns {boolean}
 */
export const isMainModule = (moduleUrl, argv1 = process.argv[1], options = {}) => {
  const platform = options.platform;
  const modulePath = modulePathFromUrl(moduleUrl, platform);
  const entryPath = entryPathFromArgv(argv1, options);
  if (modulePath === undefined || entryPath === undefined) {
    return false;
  }

  if (comparablePath(modulePath, platform) === comparablePath(entryPath, platform)) {
    return true;
  }

  // Node reports the real path of the entry module, so a checkout reached
  // through a symlink (including macOS `/var` → `/private/var`) only matches
  // once both sides are resolved.
  const realpath = options.realpath ?? safeRealpath;
  return (
    comparablePath(realpath(modulePath), platform) ===
    comparablePath(realpath(entryPath), platform)
  );
};
