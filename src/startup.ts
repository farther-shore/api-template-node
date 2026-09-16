// ---------------------------------------------------------------------------
// startup.ts — the two decisions `index.ts` makes before it can serve traffic,
// factored out so they are testable. `index.ts` itself is a module with
// top-level `await` that binds a port, so it cannot be imported by a test.
// ---------------------------------------------------------------------------

/** Default listen port. 3000 is the documented FartherShore scaffold port. */
export const DEFAULT_PORT = 3000;

/**
 * Resolve the listen port from the environment. A malformed or out-of-range
 * `PORT` falls back to the default rather than handing `app.listen` a `NaN`
 * (which silently binds a random ephemeral port — the container then passes
 * its own health check while the platform's probe hits nothing).
 */
export function resolvePort(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.PORT?.trim();
  if (!raw) return DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    return DEFAULT_PORT;
  }
  return parsed;
}

/**
 * Describe a startup bootstrap failure for the log.
 *
 * Startup bootstrap talks to core, and core answers with a typed
 * `FartherShoreError` (`code` + `message`) — for example 409 `no_backend` when
 * the business has no backend row yet. Surfacing both is the whole point: an
 * unhandled rejection here used to kill the process with a stack trace and no
 * cause, and the platform then reported a crash-looping container rather than
 * "you have not created a backend".
 */
export function describeBootstrapFailure(error: unknown): {
  code: string;
  message: string;
} {
  const code =
    typeof (error as { code?: unknown })?.code === "string"
      ? (error as { code: string }).code
      : "bootstrap_failed";
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  return { code, message };
}

/** The single line logged when startup bootstrap fails. */
export function bootstrapFailureMessage(error: unknown): string {
  const { code, message } = describeBootstrapFailure(error);
  return (
    `FartherShore startup bootstrap failed (${code}): ${message}. ` +
    "The process keeps serving GET /healthz; verified routes stay fail-closed " +
    "until bootstrap succeeds."
  );
}
