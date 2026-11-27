import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Folders on the server's own disk that the web app may read or write: the default projects folder
 * (`SF_PROJECTS_DIR`, else `~/factory-projects`) and the workspaces folder (`FACTORY_WORKSPACES_DIR`,
 * else `~/software-factory-workspaces`). Both are set by whoever runs the server, never by a request.
 */
export function serverManagedRoots(): string[] {
  const projects = (process.env.SF_PROJECTS_DIR || "").trim() || path.join(homedir(), "factory-projects");
  const workspaces =
    (process.env.FACTORY_WORKSPACES_DIR || "").trim() || path.join(homedir(), "software-factory-workspaces");
  return [projects, workspaces].map((p) => path.resolve(/* turbopackIgnore: true */ p));
}

/** The real path of `p` (symlinks resolved) when it exists, else its resolved form. */
function canonical(p: string): string {
  const abs = path.resolve(/* turbopackIgnore: true */ p);
  try {
    return realpathSync(/* turbopackIgnore: true */ abs);
  } catch {
    return abs;
  }
}

/**
 * Whether the server may touch `p` on its own disk. A project's `localPath` comes from the client and
 * names a folder on a runner, so the server reads or writes it only inside `serverManagedRoots()`.
 */
export function isServerManagedPath(p: string | null | undefined): boolean {
  if (!p) return false;
  const target = canonical(p);
  return serverManagedRoots().some((root) => {
    const base = canonical(root);
    return target === base || target.startsWith(base + path.sep);
  });
}
