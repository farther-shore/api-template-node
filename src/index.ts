import { initFromEnv } from "@farthershore/backend";
import { buildApp } from "./app.js";
import { bootstrapFailureMessage, resolvePort } from "./startup.js";

// Reporting needs FS_RUNTIME_TOKEN: without it `ctx.report()` has nothing to
// sign with, and an unmetered request is unbilled revenue. Without this
// check the process starts happily and then returns a bare 500 on every
// metered route, with nothing in the response explaining why. That is the
// normal first-deploy path: the token is host configuration, so it is easy to
// ship the image before setting it.
//
// Fail fast in production the way the platform's own services do; warn in
// development so `npm run dev` and the tests still work unconfigured.
if (!process.env.FS_RUNTIME_TOKEN) {
  const message =
    "FS_RUNTIME_TOKEN is not set. Metered routes cannot sign usage reports " +
    "and will fail. Mint one with: farthershore backend tokens create " +
    "<business> --backend <backendId>, then set it on this host.";
  if (process.env.NODE_ENV === "production") {
    console.error(`FATAL: ${message}`);
    process.exit(1);
  }
  console.warn(`WARNING: ${message}`);
}

const fs = await initFromEnv();
const app = buildApp(fs);
const port = resolvePort();

// Listen FIRST. `fs.ready()` talks to core, and core can legitimately refuse
// (409 `no_backend` before the business has a backend row, for instance). A
// process that dies on that unhandled rejection looks to the host like a
// crash-looping image; one that stays up serves `GET /healthz`, logs the
// actual code and message, and keeps every verified route fail-closed through
// the SDK middleware — which is the diagnosable failure, not the silent one.
const server = app.listen(port, () => {
  console.log(`api-template-node listening on port ${port}`);
});

// Bootstrap, reconcile the implemented route surface, and report this replica
// ready. The SDK keeps this best-effort; the catch covers the remaining case
// where bootstrap itself throws.
try {
  await fs.ready(app);
} catch (error) {
  console.error(bootstrapFailureMessage(error));
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  try {
    await fs.shutdown();
  } finally {
    server.close((error) => {
      if (error) {
        console.error(`${signal} shutdown failed`, error);
        process.exitCode = 1;
      }
    });
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
