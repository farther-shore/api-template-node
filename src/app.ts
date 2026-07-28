import type { IncomingMessage } from "node:http";
import express, { type Request, type Response } from "express";
import {
  type FartherShoreInstance,
  type FartherShoreRequestContext,
  requireMember,
  withUsage,
} from "@farthershore/backend";
import { RUNTIME_BODY_HASH_CONTRACT } from "@farthershore/backend/runtime";

// The verified context is a GUARANTEED presence on the request: the strict
// fs.middleware() attaches it before any handler runs (a missing/invalid
// signature or context is rejected fail-closed). So `fartherShore` is
// NON-OPTIONAL here — read `ctx.principal` without optional-chaining.
type VerifiedRequest = Request & {
  fartherShore: FartherShoreRequestContext;
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

  // Strict by default: every request is verified fail-closed, and the middleware
  // STRIPS every inbound x-fs-* header before the handler runs — so the verified
  // req.fartherShore context is the only identity source a handler can read.
  app.use(fs.middleware());
  app.use(parseVerifiedJson);

  app.post(
    "/v1/example",
    // fs.handler runs this only with a GUARANTEED verified context — `ctx` is a
    // non-optional FartherShoreRequestContext, and `req` is narrowed to a
    // VerifiedRequest (fartherShore present) for direct reads.
    fs.handler(async (ctx, req: VerifiedRequest, res: Response) => {
      // `ctx` is the GUARANTEED verified context — fs.handler only runs it with
      // a present context (else 401). Identity comes ONLY from here; the
      // middleware already stripped every inbound x-fs-* header, so a spoofed
      // identity/metering header is not even readable in this handler.
      //
      // The consumer principal is the verified subject behind the request:
      // `member` (a person — a portal session or a personal key) carries
      // `memberId`; `service` (an org-owned service account) carries
      // `serviceAccountId`. On a route the gateway restricts to members
      // (`requireMember: true`), narrow to the member arm with requireMember(ctx)
      // — it throws `member_subject_required` (403) for service traffic — and
      // key per-user data on the verified memberId.
      const { memberId } = requireMember(ctx);

      const body = req.body as { message?: unknown } | undefined;
      const payload = {
        message: typeof body?.message === "string" ? body.message : "Hello",
        // Scope per-user data on the verified member id, never a plaintext header.
        memberId,
        org: ctx.principal.org.id,
        planId: planIdFromContext(ctx),
      };

      // Report only custom meters your business/business.ts declares beyond the
      // built-in request count (tokens, compute seconds, …). The gateway already
      // counts requests, then verifies, settles, and strips these signed usage
      // headers; never report `requests` from the backend. Thread the verified
      // ctx.requestId — the inbound x-fs-request-id header has been stripped.
      const signed = await withUsage(
        toFetchRequest(req),
        Response.json(payload),
        { example_units: 1 },
        { env: process.env, requestId: ctx.requestId },
      );
      signed.headers.forEach((value, name) => res.setHeader(name, value));
      res.status(signed.status).json(payload);
    }),
  );

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
  const planId = ctx.signedContext?.compiledPlanId;
  return typeof planId === "string" ? planId : null;
}

function toFetchRequest(req: Request): globalThis.Request {
  const protocol = req.protocol || "http";
  const host = req.get("host") ?? "localhost";
  return new Request(`${protocol}://${host}${req.originalUrl}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
  });
}
