import type { IncomingMessage } from "node:http";
import express, { type Request, type Response } from "express";
import {
  type FartherShoreInstance,
  type FartherShoreRequestContext,
  withUsage,
} from "@farthershore/backend";
import { RUNTIME_BODY_HASH_CONTRACT } from "@farthershore/backend/runtime";

type VerifiedRequest = Request & {
  fartherShore?: FartherShoreRequestContext;
  rawBody?: Buffer;
};

const STREAMING_CONTENT_TYPES = new Set<string>(
  RUNTIME_BODY_HASH_CONTRACT.streamingExemptContentTypes,
);

export function buildApp(fs: FartherShoreInstance): express.Express {
  const app = express();

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // The FartherShore SDK hashes raw request bytes. Capture every non-streaming
  // body before fs.middleware() runs, then parse JSON only after the signed bytes
  // have been verified. Streaming-exempt content types are skipped so upload and
  // event-stream handlers can consume the request stream themselves.
  // The size limit comes from the platform contract (10 MB) — a smaller local
  // literal would 413 gateway-signed payloads the platform itself allows.
  app.use(
    express.raw({
      type: shouldCaptureRawBody,
      limit: RUNTIME_BODY_HASH_CONTRACT.maxBodyBytes,
    }),
  );
  app.use((req, _res, next) => {
    if (Buffer.isBuffer(req.body) && req.body.byteLength > 0) {
      (req as { rawBody?: Buffer }).rawBody = req.body;
    }
    next();
  });

  // Pre-keystone posture: the platform's upstream request-signing rollout is
  // not yet live, so `always: true` would reject every gateway request with
  // missing_signature. `always: false` follows the SDK's designed pre-keystone
  // contract — pass through while core's bootstrap reports verification not
  // required, and fail closed automatically the moment the platform starts
  // signing. Flip to `always: true` for strict mode once signing ships.
  app.use(fs.middleware({ always: false }));
  app.use(parseVerifiedJson);

  app.post("/v1/example", async (req: VerifiedRequest, res: Response) => {
    // Verified context is present when the gateway signs requests; absent
    // pre-keystone (the middleware passed through per the bootstrap contract).
    // Identity fields are optional until then — never trust plaintext X-FS-*
    // headers as a substitute (a direct caller can spoof them).
    const ctx = req.fartherShore;

    const body = req.body as { message?: unknown } | undefined;
    const payload = {
      message: typeof body?.message === "string" ? body.message : "Hello",
      subscriberId: ctx ? (ctx.customerId ?? ctx.tenantId ?? null) : null,
      planId: ctx ? planIdFromContext(ctx) : null,
    };

    // Read identity only from the verified SDK context. Plaintext X-FS-* headers
    // can be spoofed by a direct caller; the gateway-signed context is what the
    // middleware verified against the actual method, path, headers, and body.
    // Report only custom meters declared by your business/business.ts beyond
    // the built-in request count, such as tokens or compute seconds. The gateway
    // already counts requests, then verifies, settles, and strips these signed
    // usage headers; never report `requests` from the backend.
    const signed = await withUsage(
      toFetchRequest(req),
      Response.json(payload),
      { example_units: 1 },
      { env: process.env },
    );
    signed.headers.forEach((value, name) => res.setHeader(name, value));
    res.status(signed.status).json(payload);
  });

  return app;
}

function shouldCaptureRawBody(req: IncomingMessage): boolean {
  return !isStreamingExempt(headerValue(req.headers, "content-type"));
}

function isStreamingExempt(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const base = contentType.split(";")[0]?.trim().toLowerCase();
  return base !== undefined && STREAMING_CONTENT_TYPES.has(base);
}

function parseVerifiedJson(
  req: Request,
  res: Response,
  next: express.NextFunction,
): void {
  if (!isJsonContentType(req.get("content-type"))) {
    next();
    return;
  }
  if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
    next();
    return;
  }

  try {
    req.body = JSON.parse(req.body.toString("utf8")) as unknown;
    next();
  } catch {
    res.status(400).json({ error: "invalid_json" });
  }
}

function isJsonContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return contentType.split(";")[0]?.trim().toLowerCase() === "application/json";
}

function headerValue(
  headers: IncomingMessage["headers"],
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function planIdFromContext(ctx: FartherShoreRequestContext): string | null {
  const signed = ctx.signedContext as { planId?: unknown } | undefined;
  return typeof signed?.planId === "string" ? signed.planId : null;
}

function toFetchRequest(req: Request): globalThis.Request {
  const protocol = req.protocol || "http";
  const host = req.get("host") ?? "localhost";
  return new Request(`${protocol}://${host}${req.originalUrl}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
  });
}
