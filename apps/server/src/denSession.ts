// @effect-diagnostics nodeBuiltinImport:off -- runs the `den` CLI.
import * as NodeChildProcess from "node:child_process";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const DEN = "/usr/bin/den";
// The first session on a project installs its dependencies.
const CREATE_TIMEOUT_MS = 20 * 60 * 1_000;
const DISCARD_TIMEOUT_MS = 60 * 1_000;

export class DenSessionError extends Schema.TaggedError<DenSessionError>()("DenSessionError", {
  detail: Schema.String,
}) {
  override get message() {
    return this.detail;
  }
}

const DenSessionRecord = Schema.Struct({ id: Schema.String, workspace: Schema.String });
const decodeSessions = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(DenSessionRecord)),
);
const decodeSession = Schema.decodeUnknownEffect(Schema.fromJsonString(DenSessionRecord));
const unreadable = () => new DenSessionError({ detail: "Couldn't read `den`'s reply." });

const runDen = (args: ReadonlyArray<string>, timeout: number) =>
  Effect.callback<string, DenSessionError>((resume, signal) => {
    NodeChildProcess.execFile(
      DEN,
      [...args],
      { signal, timeout, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error === null) return resume(Effect.succeed(stdout));
        const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
        const said = stderr
          .split("\n")
          .map((line) => line.replace(/^den:\s*/, "").trim())
          .findLast((line) => line.length > 0);
        resume(
          Effect.fail(
            new DenSessionError({
              detail: missing ? "Sessions need Den Den's `den` command." : (said ?? error.message),
            }),
          ),
        );
      },
    );
  });

/** The thread's session, made on first use; a retried launch finds the one it already has. */
export const openDenSession = Effect.fn("DenSession.open")(function* (
  project: string,
  threadId: string,
) {
  const name = `t3-${threadId
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 16)
    .toLowerCase()}`;
  const listed = yield* runDen(["session", "list", "--json"], DISCARD_TIMEOUT_MS).pipe(
    Effect.flatMap((reply) => decodeSessions(reply).pipe(Effect.mapError(unreadable))),
  );
  const session =
    listed.find((candidate) => candidate.id === name) ??
    (yield* runDen(
      ["session", "create", project, "--name", name, "--json"],
      CREATE_TIMEOUT_MS,
    ).pipe(Effect.flatMap((reply) => decodeSession(reply).pipe(Effect.mapError(unreadable)))));
  return { worktreePath: session.workspace, branch: `den/${session.id}` };
});

export const discardDenSession = (session: string) =>
  runDen(["session", "discard", session, "--stop"], DISCARD_TIMEOUT_MS).pipe(Effect.asVoid);
