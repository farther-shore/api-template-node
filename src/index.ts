import { initFromEnv } from "@farthershore/backend";
import { buildApp } from "./app.js";

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
