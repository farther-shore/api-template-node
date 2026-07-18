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

```sh
farthershore backend tokens create <business> --kind live
```

The template exposes open liveness at `GET /healthz` and an example protected
route at `POST /v1/example`.

## Deploy

Build and run this service on any Docker host:

```sh
docker build -t my-business-api .
docker run -p 8080:8080 --env FS_RUNTIME_TOKEN=fsrt_... my-business-api
```

## Runtime-token notes

- Mint tokens WITHOUT `--backend` for now (`farthershore backend tokens create <business> --kind live`). Backend-bound tokens fail signed-metering verification until the platform publishes the compiled-backend artifact to the edge.
- Verification runs in the SDK's pre-keystone posture (`always: false`): requests pass through unverified while the platform's upstream signing rollout is pending, and fail closed automatically once it ships. Keep this origin URL unadvertised — the gateway is the only intended caller.

## FartherShore Loop

1. Mint a runtime token. The token is shown once:

   ```sh
   farthershore backend tokens create <business> --kind live
   ```

2. Set `FS_RUNTIME_TOKEN` on your host.

3. Register the public origin:

   ```sh
   farthershore backend create <business> --name api --transport direct --origin-url https://<host> --default
   ```

4. For a backend that is not publicly reachable, use the tunnel transport
   instead of `direct`.

Routes must be declared in `business/business.ts` features before subscribers
can reach them through the gateway.
