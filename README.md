# FartherShore Node API Template

This is a starter backend for a FartherShore business's own upstream API. It is
deployed outside FartherShore on the Docker host you choose, then registered as
the business backend that the FartherShore gateway forwards subscriber traffic
to.

## Local Dev

```sh
npm install
npm run dev
```

Set `FS_RUNTIME_TOKEN` in the environment before running against a real
FartherShore gateway. `FS_CORE_URL` is optional and normally unnecessary because
the runtime token bootstrap discovers the correct platform URLs.

`FS_RUNTIME_TOKEN` is host configuration, not a file: mint it once and set it
as an environment variable on your cloud instance (your host's env-var
settings, `docker run --env`, or your platform's secrets manager). Never
commit it or keep it in a local dotenv file.

The template exposes open liveness at `GET /healthz` and an example protected
route at `POST /v1/example`.

## Deploy

Build and run this service on any Docker host:

```sh
docker build -t my-business-api .
docker run -p 3000:3000 --env FS_RUNTIME_TOKEN=fsrt_... my-business-api
```

The service listens on `PORT`, defaulting to **3000** — the port the
FartherShore scaffold and transport-mode docs assume. Set `PORT` to override it.

## Runtime-token notes

- This template serves one logical backend, so use a backend-scoped token. The
  scope binds bootstrap, request verification, health, and metering to that
  backend instead of granting the deployment access to every backend in the
  business.
- Verification is strict by default. Missing, invalid, or mismatched gateway
  signatures fail closed; never set `{ always: false }` for a production
  deployment. Keep the origin URL unadvertised — the gateway is the only
  intended caller.

## FartherShore Loop

1. Register the public origin and keep the returned backend id:

   ```sh
   farthershore backend create <business> \
     --name api \
     --transport direct \
     --origin-url https://<host> \
     --default \
     --idempotency-key <persisted-backend-create-attempt-key> \
     --format json
   ```

2. Mint a backend-scoped runtime token. The token is shown once, so capture it
   directly into your host's secret manager and never commit or log it:

   ```sh
   farthershore backend tokens create <business> \
     --backend <backend-id> \
     --kind live \
     --idempotency-key <persisted-runtime-token-create-attempt-key> \
     --format json
   ```

3. Set `FS_RUNTIME_TOKEN` on your host. Set `FS_CORE_URL` when the deployment
   targets a non-production Farther Shore environment, then deploy or restart
   the service. Startup binds the port first, then calls `fs.ready(app)`, which
   bootstraps the backend, reconciles routes, and reports the replica ready. A
   bootstrap failure (for example 409 `no_backend` before step 1 has run) is
   logged with its code and message and does NOT stop the process: `/healthz`
   stays up so the host can tell "misconfigured" from "crashed", while every
   verified route still fails closed.

4. Confirm the platform sees the backend as healthy:

   ```sh
   farthershore backend list <business> --format json
   ```

Routes must be declared in `business/business.ts` features before subscribers
can reach them through the gateway.
