import { initFromEnv } from "@farthershore/backend";
import { buildApp } from "./app.js";

// `withUsage` THROWS when FS_RUNTIME_TOKEN is absent — it does not silently
// degrade, because an unmetered request is unbilled revenue. Without this
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
const port = Number(process.env.PORT ?? 8080);

const server = app.listen(port, () => {
  console.log(`api-template-node listening on :${port}`);
});

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
