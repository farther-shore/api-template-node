import { Readable, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { FartherShoreInstance } from "@farthershore/backend";
import { createDevRuntime } from "@farthershore/backend/testing";
import { buildApp } from "./app.js";

const usageEnv = {
  FS_RUNTIME_TOKEN: "fsrt_live_test_00000000000000000000000000000000",
};

vi.mock("@farthershore/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@farthershore/backend")>();
  return {
    ...actual,
    withUsage: vi.fn(async (_req, response, _usage) => response),
  };
});

type AppResponse = {
  status: number;
  body: unknown;
  headers: Record<string, string | number | readonly string[]>;
};

type MockResponse = Writable & {
  statusCode: number;
  headers: Record<string, string | number | readonly string[]>;
  setHeader(name: string, value: string | number | readonly string[]): void;
  getHeader(name: string): string | number | readonly string[] | undefined;
  removeHeader(name: string): void;
  writeHead(
    code: number,
    headers?: Record<string, string | number | readonly string[]>,
  ): MockResponse;
};

type RawBodyProbe = (req: { body?: unknown; rawBody?: Buffer }) => void;

async function requestApp(
  app: ReturnType<typeof buildApp>,
  {
    method,
    path,
    body,
    headers = {},
  }: {
    method: string;
    path: string;
    body?: string;
    headers?: Record<string, string>;
  },
): Promise<AppResponse> {
  const bodyBuffer = body ? Buffer.from(body) : null;
  const req = Readable.from(bodyBuffer ? [bodyBuffer] : []);
  Object.assign(req, {
    method,
    url: path,
    originalUrl: path,
    headers: normalizeHeaders({
      host: "localhost",
      ...(bodyBuffer
        ? { "content-length": String(bodyBuffer.byteLength) }
        : {}),
      ...headers,
    }),
    socket: { encrypted: false },
  });

  const chunks: Buffer[] = [];
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  }) as MockResponse;
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (name, value) => {
    res.headers[name.toLowerCase()] = value;
  };
  res.getHeader = (name) => res.headers[name.toLowerCase()];
  res.removeHeader = (name) => {
    delete res.headers[name.toLowerCase()];
  };
  res.writeHead = (code, responseHeaders = {}) => {
    res.statusCode = code;
    for (const [name, value] of Object.entries(responseHeaders)) {
      res.setHeader(name, value);
    }
    return res;
  };
  const originalEnd = res.end.bind(res);
  res.end = ((chunk?: unknown, encoding?: BufferEncoding, cb?: () => void) => {
    if (chunk) chunks.push(Buffer.from(chunk as string | Uint8Array));
    return originalEnd(undefined, encoding, cb);
  }) as MockResponse["end"];

  return await new Promise<AppResponse>((resolve, reject) => {
    res.on("finish", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      resolve({
        status: res.statusCode,
        body: text ? (JSON.parse(text) as unknown) : undefined,
        headers: res.headers,
      });
    });
    app.handle(req, res, (error) => {
      if (error) reject(error);
    });
  });
}

function normalizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

function buildAppWithRawBodyProbe(
  probe: RawBodyProbe,
): ReturnType<typeof buildApp> {
  const fs = {
    middleware: vi.fn(() => (req, _res, next) => {
      probe(req);
      Object.assign(req, {
        fartherShore: {
          customerId: null,
          tenantId: null,
          signedContext: {},
        },
      });
      next();
    }),
  } as unknown as FartherShoreInstance;
  return buildApp(fs);
}

describe("api template app", () => {
  it("serves healthz without FartherShore verification", async () => {
    // The middleware FACTORY is invoked once at mount time (that's normal);
    // the guarantee under test is that a /healthz REQUEST never flows through
    // the returned verification handler.
    const fs = {
      middleware: vi.fn(() => () => {
        throw new Error("healthz must not pass through fs.middleware()");
      }),
    } as unknown as FartherShoreInstance;
    const app = buildApp(fs);

    const res = await requestApp(app, {
      method: "GET",
      path: "/healthz",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("verifies a real signed JSON request and reports custom usage", async () => {
    process.env.FS_RUNTIME_TOKEN = usageEnv.FS_RUNTIME_TOKEN;
    const { withUsage } = await import("@farthershore/backend");
    vi.mocked(withUsage).mockClear();
    const runtime = createDevRuntime({ mode: "simulated" });
    const app = buildApp(runtime.fs);
    const body = JSON.stringify({ message: "pong" });
    const signedHeaders = await runtime.asPersona("owner").headers({
      method: "POST",
      path: "/v1/example",
      body: new TextEncoder().encode(body),
    });

    const res = await requestApp(app, {
      method: "POST",
      path: "/v1/example",
      headers: {
        "content-type": "application/json",
        ...signedHeaders,
      },
      body,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: "pong",
      subscriberId: null,
      planId: null,
    });
    expect(withUsage).toHaveBeenCalledWith(
      expect.any(Request),
      expect.any(Response),
      { example_units: 1 },
      { env: process.env },
    );
  });

  it("captures JSON raw bytes before verification and parses JSON after verification", async () => {
    const probe = vi.fn<RawBodyProbe>((req) => {
      expect(Buffer.isBuffer(req.body)).toBe(true);
      expect(req.rawBody?.toString("utf8")).toBe('{"message":"pong"}');
    });
    const app = buildAppWithRawBodyProbe(probe);

    const res = await requestApp(app, {
      method: "POST",
      path: "/v1/example",
      headers: { "content-type": "application/json" },
      body: '{"message":"pong"}',
    });

    expect(probe).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: "pong" });
  });

  it("captures text/plain raw bytes before verification", async () => {
    const probe = vi.fn<RawBodyProbe>((req) => {
      expect(Buffer.isBuffer(req.body)).toBe(true);
      expect(req.rawBody?.toString("utf8")).toBe("plain payload");
    });
    const app = buildAppWithRawBodyProbe(probe);

    const res = await requestApp(app, {
      method: "POST",
      path: "/v1/example",
      headers: { "content-type": "text/plain" },
      body: "plain payload",
    });

    expect(probe).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: "Hello" });
  });

  it("captures a payload above 1 MB (contract allows up to 10 MB)", async () => {
    // Regression: a local "1mb" parser limit 413'd gateway-signed payloads the
    // platform contract permits. The limit must come from
    // RUNTIME_BODY_HASH_CONTRACT.maxBodyBytes.
    const big = "x".repeat(2 * 1024 * 1024);
    const probe = vi.fn<RawBodyProbe>((req) => {
      expect(req.rawBody?.byteLength).toBe(big.length);
    });
    const app = buildAppWithRawBodyProbe(probe);

    const res = await requestApp(app, {
      method: "POST",
      path: "/v1/example",
      headers: { "content-type": "text/plain" },
      body: big,
    });

    expect(probe).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });

  it("leaves rawBody absent for an empty body", async () => {
    const probe = vi.fn<RawBodyProbe>((req) => {
      expect(req.rawBody).toBeUndefined();
    });
    const app = buildAppWithRawBodyProbe(probe);

    const res = await requestApp(app, {
      method: "POST",
      path: "/v1/example",
      headers: { "content-type": "application/json" },
    });

    expect(probe).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: "Hello" });
  });

  it("returns 400 for invalid JSON after verification", async () => {
    const probe = vi.fn<RawBodyProbe>();
    const app = buildAppWithRawBodyProbe(probe);

    const res = await requestApp(app, {
      method: "POST",
      path: "/v1/example",
      headers: { "content-type": "application/json" },
      body: '{"message":',
    });

    expect(probe).toHaveBeenCalledOnce();
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_json" });
  });
});
