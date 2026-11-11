/**
 * cli/uninstall-guard.ts — uninstall may remove Wavesmith's own files only.
 * Every target is resolved with realpath, so a symlink or ".." cannot point the
 * delete at /, home, or a parent of the install. A refused path is not deleted.
 */

import fs from "node:fs";
import path from "node:path";

export interface DeleteVerdict {
  ok: boolean;
  message: string;
}

function filesystemRoot(target: string): string {
  return path.parse(path.resolve(target)).root;
}

/** Follow symlinks. A missing leaf keeps the real path of the parent that does exist. */
export function resolveForDelete(target: string): string {
  const raw = target.trim();
  if (!raw) return filesystemRoot(".");
  try {
    return fs.realpathSync(raw);
  } catch {
    // The path may not exist yet. Try the normalized form, then the nearest parent.
  }
  const lexical = path.resolve(raw);
  try {
    return fs.realpathSync(lexical);
  } catch {
    return withRealParent(lexical);
  }
}

function withRealParent(lexical: string): string {
  const root = filesystemRoot(lexical);
  let cursor = lexical;
  const tail: string[] = [];
  while (cursor !== root) {
    try {
      const found = fs.realpathSync(cursor);
      return tail.length === 0 ? found : path.resolve(found, ...tail);
    } catch {
      tail.unshift(path.basename(cursor));
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  try {
    const found = fs.realpathSync(root);
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

/** The installer writes these. A directory that has one is a Wavesmith folder. */
export function hasWavesmithMarker(dir: string): boolean {
  const progress = path.join(dir, "setup-progress.json");
  try {
    if (fs.statSync(progress).isFile()) return true;
  } catch {
    // Not the data directory.
  }
  const rootFile = path.join(dir, "root");
  try {
    if (!fs.statSync(rootFile).isFile()) return false;
    return fs.readFileSync(rootFile, "utf8").trim().startsWith("/");
  } catch {
    return false;
  }
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

/**
 * True only for a Wavesmith file or folder.
 * / , home, parents of home or of the install, and the install folder itself are never allowed.
 */
export function classifyDelete(
  target: string,
  input: { home: string; root: string; env: Record<string, string | undefined> },
): DeleteVerdict {
  const resolved = resolveForDelete(target);
  const home = resolveForDelete(input.home);
  const root = resolveForDelete(input.root);
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
  const installIsSafe = resolved !== disk && !samePath(root, disk) && !samePath(root, home) && !isStrictlyInside(home, root);
  if (installIsSafe && isStrictlyInside(resolved, root)) return { ok: true, message: "" };
  for (const known of knownUninstallPaths(home, input.env)) {
    const place = resolveForDelete(known);
    if (samePath(resolved, place) || isStrictlyInside(resolved, place)) return { ok: true, message: "" };
  }
  try {
    if (fs.statSync(resolved).isDirectory() && hasWavesmithMarker(resolved)) return { ok: true, message: "" };
  } catch {
    // Missing, or not a directory. It is not a marked Wavesmith folder.
  }
  return {
    ok: false,
    message: `Refusing to delete ${target}. It is not inside the Wavesmith folder or a known Wavesmith location.`,
  };
}
