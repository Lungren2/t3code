import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/**
 * Den Den sessions: a thread whose folder is a session's workspace is sandboxed.
 * The folder alone decides it, so every launch path (new, resumed, retried,
 * terminal) gets the same answer. What the agent writes there is untrusted:
 * nothing outside the sandbox may run it or start a program configured by it.
 */
const DEN = "/usr/bin/den";
const WORKSPACE = /\/den\/sessions\/([A-Za-z0-9][A-Za-z0-9._-]*)\/workspace(?:\/|$)/;

export const DEN_SESSION_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent", "codex"]);

export function denSessionForPath(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  return WORKSPACE.exec(NodePath.resolve(cwd))?.[1] ?? null;
}

/** COMMAND as it runs inside the session's sandbox. */
export function denSessionLaunch(
  session: string,
  command: string,
  args: ReadonlyArray<string>,
): { readonly command: string; readonly args: ReadonlyArray<string> } {
  return { command: DEN, args: ["session", "exec", session, "--", command, ...args] };
}

/** For host tools given a session's folder: an empty directory with no project config to load. */
export function outsideDenSession(cwd: string): string {
  if (denSessionForPath(cwd) === null) return cwd;
  const neutral = NodePath.join(NodeOS.homedir(), ".cache", "den", "host-tools");
  NodeFS.mkdirSync(neutral, { recursive: true });
  return neutral;
}
