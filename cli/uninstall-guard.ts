/**
 * cli/uninstall-guard.ts — uninstall may remove Wavesmith's own files only.
 * Every target is resolved with realpath. Recursive delete is an allowlist:
 * data/, engine/, node_modules, and the Next build inside the checkout; the
 * launcher, menu bar app, login item, and state directory under home; or a
 * custom data, engine, or state directory inside home whose name contains
 * "Wavesmith" and has the installer's marker. Documents, Music, Library, .ssh,
 * and the other standard home folders are refused. A symlink is unlinked.
 * The folder it points at is not removed. Anything outside home is refused.
 */

import fs from "node:fs";
import path from "node:path";
import { stateDirectory } from "./paths.ts";
import { resolveConfiguredDir } from "./plans.ts";

export interface DeleteVerdict {
  ok: boolean;
  message: string;
  /** The path is a symlink. Remove the link and leave the folder it points at. */
  unlinkOnly?: boolean;
}

/** Filesystem calls the guard needs. Tests pass a fake root so nothing touches the real disk. */
export interface DeleteIO {
  realpathSync(target: string): string;
  lstatSync(target: string): { isSymbolicLink(): boolean };
  statSync(target: string): { isFile(): boolean; isDirectory(): boolean };
  readFileSync(target: string, encoding: "utf8"): string;
}

const hostDeleteIO: DeleteIO = {
  realpathSync: (target) => fs.realpathSync(target),
  lstatSync: (target) => fs.lstatSync(target),
  statSync: (target) => fs.statSync(target),
  readFileSync: (target, encoding) => fs.readFileSync(target, encoding),
};

/** Standard home folders. A custom data or state path may not be one of these, or a parent of one. */
export const HOME_FOLDER_DENY = [
  "Library",
  "Documents",
  "Desktop",
  "Downloads",
  "Music",
  "Movies",
  "Pictures",
  "Public",
  "Applications",
  ".ssh",
  ".gnupg",
  ".config",
  ".local",
  ".cache",
  "iCloud Drive",
] as const;

/** data/, the engine tree, dependencies, and the Next build. Nothing else in the checkout. */
const INSTALL_SUBDIRS = ["data", "engine", "node_modules", ".next"] as const;

function filesystemRoot(target: string): string {
  return path.parse(path.resolve(target)).root;
}

/** Follow symlinks. A missing leaf keeps the real path of the parent that does exist. */
export function resolveForDelete(target: string, io: DeleteIO = hostDeleteIO): string {
  const raw = target.trim();
  if (!raw) return filesystemRoot(".");
  try {
    return io.realpathSync(raw);
  } catch {
    // The path may not exist yet. Try the normalized form, then the nearest parent.
  }
  const lexical = path.resolve(raw);
  try {
    return io.realpathSync(lexical);
  } catch {
    return withRealParent(lexical, io);
  }
}

function withRealParent(lexical: string, io: DeleteIO): string {
  const root = filesystemRoot(lexical);
  let cursor = lexical;
  const tail: string[] = [];
  while (cursor !== root) {
    try {
      const found = io.realpathSync(cursor);
      return tail.length === 0 ? found : path.resolve(found, ...tail);
    } catch {
      tail.unshift(path.basename(cursor));
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  try {
    const found = io.realpathSync(root);
    return tail.length === 0 ? found : path.resolve(found, ...tail);
  } catch {
    return lexical;
  }
}

function isStrictlyInside(child: string, parent: string): boolean {
  if (!parent || parent === filesystemRoot(parent)) return false;
  const rel = path.relative(parent, child);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Top-level system directories. macOS realpath of /tmp, /var, and /etc lands under /private. */
export const SYSTEM_DIR_NAMES = [
  "usr",
  "var",
  "opt",
  "tmp",
  "etc",
  "bin",
  "sbin",
  "lib",
  "System",
  "Library",
  "Applications",
  "Users",
  "private",
  "Volumes",
] as const;

const MACOS_REALPATH_ALIASES = ["private/tmp", "private/var", "private/etc"] as const;

const MARKER_PHASES = new Set(["setup", "weights", "failed", "stopped", "done"]);

/** Files stop and the start lock may remove without deleting the state directory. */
const STATE_BOOKKEEPING = new Set(["wavesmith.pid", "start.lock"]);

export function systemDeleteAnchors(io: DeleteIO = hostDeleteIO): string[] {
  const disk = filesystemRoot("/");
  const anchors = new Set<string>();
  for (const name of SYSTEM_DIR_NAMES) {
    const lexical = path.resolve(disk, name);
    anchors.add(lexical);
    try {
      anchors.add(io.realpathSync(lexical));
    } catch {
      // The directory is not on this machine. The lexical path stays denied.
    }
  }
  for (const alias of MACOS_REALPATH_ALIASES) anchors.add(path.resolve(disk, alias));
  return [...anchors];
}

/** Depth 1 from /, a known system directory, its realpath, or a parent of one of those. */
export function isDeniedSystemPath(resolved: string, anchors: readonly string[]): boolean {
  const disk = filesystemRoot(resolved);
  if (resolved === disk) return true;
  const rel = path.relative(disk, resolved);
  if (rel.length > 0 && !rel.startsWith("..") && !rel.includes(path.sep)) return true;
  for (const anchor of anchors) {
    const place = path.resolve(anchor);
    if (path.resolve(resolved) === place) return true;
    if (isStrictlyInside(place, resolved)) return true;
  }
  return false;
}

/**
 * setup-progress.json as the installer writes it.
 * A file that only exists, or a `root` file that starts with "/", is not a marker.
 */
export function hasWavesmithMarker(dir: string, io: DeleteIO = hostDeleteIO): boolean {
  let text: string;
  try {
    const progress = path.join(dir, "setup-progress.json");
    if (!io.statSync(progress).isFile()) return false;
    text = io.readFileSync(progress, "utf8");
  } catch {
    return false;
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return false;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  if (typeof record.running !== "boolean") return false;
  if (typeof record.phase !== "string" || !MARKER_PHASES.has(record.phase)) return false;
  if (typeof record.message !== "string" || record.message.trim().length === 0) return false;
  if (typeof record.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(record.updatedAt)) {
    return false;
  }
  if (record.percent !== null && typeof record.percent !== "number") return false;
  if (record.etaSeconds !== null && typeof record.etaSeconds !== "number") return false;
  return true;
}

/** Process env wins, then .env, then the defaults. Paths are absolute so the allowlist can match them. */
export function deleteClassifyEnv(input: {
  root: string;
  stateDir: string;
  env: Record<string, string | undefined>;
  envText: string | null;
}): Record<string, string | undefined> {
  return {
    ...input.env,
    DATA_DIR: resolveConfiguredDir(input.root, input.envText, "DATA_DIR", "data", input.env),
    ENGINE_DIR: resolveConfiguredDir(input.root, input.envText, "ENGINE_DIR", "engine/ACE-Step-1.5", input.env),
    WAVESMITH_STATE_DIR: input.env.WAVESMITH_STATE_DIR?.trim() || input.stateDir,
  };
}

export function knownUninstallPaths(home: string, env: Record<string, string | undefined>): string[] {
  const paths = [
    path.join(home, ".local", "bin", "wavesmith"),
    path.join(home, "Applications", "Wavesmith.app"),
    path.join(home, "Library", "LaunchAgents", "com.wavesmith.login.plist"),
    path.join(home, "Library", "Application Support", "Wavesmith"),
    path.join(home, ".local", "state", "wavesmith"),
  ];
  const xdg = env.XDG_STATE_HOME?.trim();
  if (xdg && xdg !== "/" && xdg !== home) paths.push(path.join(xdg, "wavesmith"));
  return paths;
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function matchesTree(resolved: string, place: string): boolean {
  return samePath(resolved, place) || isStrictlyInside(resolved, place);
}

function deniedHomePaths(home: string): string[] {
  const paths = HOME_FOLDER_DENY.map((name) => path.join(home, name));
  paths.push(path.join(home, "Library", "Application Support"));
  paths.push(path.join(home, "Library", "Mobile Documents"));
  paths.push(path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs"));
  return paths;
}

/** A well-known home folder, or a parent that would take that folder with it. */
export function isDeniedHomeFolder(resolved: string, home: string): boolean {
  for (const place of deniedHomePaths(home)) {
    const abs = path.resolve(place);
    if (samePath(resolved, abs)) return true;
    if (isStrictlyInside(abs, resolved)) return true;
  }
  return false;
}

function basenameHasWavesmith(resolved: string): boolean {
  return path.basename(resolved).toLowerCase().includes("wavesmith");
}

/** The checkout is the home folder, or a parent of it. Uninstall must not run. */
export function checkoutBlocksUninstall(home: string, root: string, io: DeleteIO = hostDeleteIO): boolean {
  const resolvedHome = resolveForDelete(home, io);
  const resolvedRoot = resolveForDelete(root, io);
  return samePath(resolvedHome, resolvedRoot) || isStrictlyInside(resolvedHome, resolvedRoot);
}

function isKnownLeaf(lexical: string, home: string, env: Record<string, string | undefined>): boolean {
  const abs = path.resolve(lexical);
  return knownUninstallPaths(home, env).some((known) => samePath(abs, known));
}

/** A configured directory that is a symlink may lose the link. The target stays. */
function customLinkMayUnlink(
  lexical: string,
  home: string,
  root: string,
  env: Record<string, string | undefined>,
  io: DeleteIO,
): boolean {
  const configured = (["DATA_DIR", "ENGINE_DIR", "WAVESMITH_STATE_DIR"] as const).some((key) => {
    const raw = env[key]?.trim();
    if (!raw) return false;
    const place = path.resolve(raw.startsWith("/") ? raw : path.resolve(root, raw));
    return samePath(place, lexical);
  });
  if (!configured) return false;
  if (!isStrictlyInside(lexical, home)) return false;
  if (!basenameHasWavesmith(lexical)) return false;
  if (isDeniedHomeFolder(lexical, home)) return false;
  return hasWavesmithMarker(lexical, io);
}

/** The directories uninstall is willing to remove, after the hard denials. */
function isAllowedRecursive(
  resolved: string,
  input: { home: string; root: string; env: Record<string, string | undefined>; io: DeleteIO },
): boolean {
  if (!isStrictlyInside(resolved, input.home)) return false;
  if (isDeniedHomeFolder(resolved, input.home)) return false;
  // ~/data is not Wavesmith's data when the checkout is the home folder itself.
  if (isStrictlyInside(input.root, input.home)) {
    for (const name of INSTALL_SUBDIRS) {
      if (matchesTree(resolved, path.resolve(input.root, name))) return true;
    }
  }
  for (const known of knownUninstallPaths(input.home, input.env)) {
    // A symlink is unlinked by the caller. Its target is not an allowed tree.
    if (isSymbolicLink(known, input.io)) continue;
    const place = resolveForDelete(known, input.io);
    if (!isStrictlyInside(place, input.home)) continue;
    if (matchesTree(resolved, place)) return true;
  }
  for (const key of ["DATA_DIR", "ENGINE_DIR", "WAVESMITH_STATE_DIR"] as const) {
    const raw = input.env[key]?.trim();
    if (!raw) continue;
    const lexical = path.resolve(raw.startsWith("/") ? raw : path.resolve(input.root, raw));
    if (isSymbolicLink(lexical, input.io)) continue;
    const configured = resolveForDelete(lexical, input.io);
    if (!isStrictlyInside(configured, input.home)) continue;
    if (!basenameHasWavesmith(configured)) continue;
    if (isDeniedHomeFolder(configured, input.home)) continue;
    if (!matchesTree(resolved, configured)) continue;
    if (hasWavesmithMarker(configured, input.io)) return true;
  }
  return false;
}

/**
 * True only for a Wavesmith file or folder on the allowlist.
 * /, home, parents of home or of the install, the install folder, and system folders stay refused.
 * A marker outside home does not widen the list.
 */
export function classifyDelete(
  target: string,
  input: { home: string; root: string; env: Record<string, string | undefined>; io?: DeleteIO },
): DeleteVerdict {
  const io = input.io ?? hostDeleteIO;
  if (isSymbolicLink(target, io)) {
    const pointed = resolveForDelete(target, io);
    const home = resolveForDelete(input.home, io);
    const root = resolveForDelete(input.root, io);
    const lexical = path.resolve(target.trim());
    const stays = `Unlinking ${target}. It points at ${pointed}, which stays.`;
    if (isKnownLeaf(lexical, home, input.env) || customLinkMayUnlink(lexical, home, root, input.env, io)) {
      return { ok: true, unlinkOnly: true, message: stays };
    }
    return {
      ok: false,
      message: `Refusing to delete ${target}. That link points at ${pointed}, which stays.`,
    };
  }
  const resolved = resolveForDelete(target, io);
  const home = resolveForDelete(input.home, io);
  const root = resolveForDelete(input.root, io);
  const disk = filesystemRoot(resolved);
  if (resolved === disk) {
    return { ok: false, message: `Refusing to delete ${target}. That is the whole disk.` };
  }
  if (samePath(resolved, home)) {
    return { ok: false, message: `Refusing to delete ${target}. That is your home folder.` };
  }
  if (isStrictlyInside(home, resolved) || isStrictlyInside(root, resolved)) {
    return {
      ok: false,
      message: `Refusing to delete ${target}. That folder contains your home or the Wavesmith install.`,
    };
  }
  if (samePath(resolved, root)) {
    return {
      ok: false,
      message: `Refusing to delete ${target}. That is the Wavesmith folder, so your songs stay put.`,
    };
  }
  if (isDeniedSystemPath(resolved, systemDeleteAnchors(io))) {
    return {
      ok: false,
      message: `Refusing to delete ${target}. That is a system folder.`,
    };
  }
  if (isStateBookkeepingFile(resolved, { home, root, env: input.env, io })) return { ok: true, message: "" };
  if (checkoutBlocksUninstall(home, root, io)) {
    return {
      ok: false,
      message: `Refusing to delete ${target}. The Wavesmith folder is your home folder, or it contains your home.`,
    };
  }
  if (isDeniedHomeFolder(resolved, home)) {
    return { ok: false, message: `Refusing to delete ${target}. That home folder stays.` };
  }
  if (!isStrictlyInside(resolved, home)) {
    return { ok: false, message: `Refusing to delete ${target}. That is outside your home folder.` };
  }
  if (isAllowedRecursive(resolved, { home, root, env: input.env, io })) return { ok: true, message: "" };
  return {
    ok: false,
    message: `Refusing to delete ${target}. It is not inside the Wavesmith folder or a known Wavesmith location.`,
  };
}

function isSymbolicLink(target: string, io: DeleteIO): boolean {
  try {
    return io.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Recursive delete follows a real directory. A symlink is unlinked and its target stays. */
export function commitDelete(file: string, verdict: DeleteVerdict): void {
  if (!verdict.ok && !verdict.unlinkOnly) return;
  let link = verdict.unlinkOnly === true;
  if (!link) {
    try {
      link = fs.lstatSync(file).isSymbolicLink();
    } catch {
      link = false;
    }
  }
  if (link) {
    try {
      fs.unlinkSync(file);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
    }
    return;
  }
  fs.rmSync(file, { recursive: true, force: true });
}

/** Unlink wavesmith.pid or start.lock inside a custom state dir. The directory itself stays refused. */
function isStateBookkeepingFile(
  resolved: string,
  input: { home: string; root: string; env: Record<string, string | undefined>; io: DeleteIO },
): boolean {
  if (!STATE_BOOKKEEPING.has(path.basename(resolved))) return false;
  const stateDir = resolveForDelete(
    stateDirectory({ env: input.env, home: input.home, platform: process.platform }),
    input.io,
  );
  if (!samePath(path.dirname(resolved), stateDir)) return false;
  const disk = filesystemRoot(stateDir);
  if (stateDir === disk || samePath(stateDir, input.home) || samePath(stateDir, input.root)) return false;
  if (isStrictlyInside(input.home, stateDir) || isStrictlyInside(input.root, stateDir)) return false;
  if (isDeniedSystemPath(stateDir, systemDeleteAnchors(input.io))) return false;
  return true;
}
