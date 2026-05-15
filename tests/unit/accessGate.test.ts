// @vitest-environment node

import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

const requireAccessGate = createRequire(import.meta.url);

const createResponse = () => {
  let statusCode = 0;
  let body = "";
  let resolveEnd: (value: string) => void = () => {};
  const ended = new Promise<string>((resolve) => {
    resolveEnd = resolve;
  });
  const headers: Record<string, string> = {};

  return {
    headers,
    ended,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(value?: string) {
      body = value ?? "";
      resolveEnd(body);
    },
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    get body() {
      return body;
    },
  };
};

const createStreamRequest = ({
  method,
  url,
  headers = {},
  remoteAddress = "127.0.0.1",
}: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  remoteAddress?: string;
}) => {
  const req = new PassThrough() as PassThrough & {
    method: string;
    url: string;
    headers: Record<string, string>;
    socket: { remoteAddress: string };
  };

  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = { remoteAddress };
  return req;
};

describe("createAccessGate", () => {
  it("allows when token is unset", async () => {
    const { createAccessGate } = await import("../../server/access-gate");
    const gate = createAccessGate({ token: "" });
    expect(gate.allowUpgrade({ headers: {} })).toBe(true);
  });

  it("rejects /api requests without cookie when enabled", async () => {
    const { createAccessGate } = await import("../../server/access-gate");
    const gate = createAccessGate({ token: "abc" });

    let statusCode = 0;
    let ended = false;
    const res = {
      setHeader: () => {},
      end: () => {
        ended = true;
      },
      get statusCode() {
        return statusCode;
      },
      set statusCode(value: number) {
        statusCode = value;
      },
    };

    const handled = gate.handleHttp(
      { url: "/api/studio", headers: { host: "example.test" } },
      res
    );

    expect(handled).toBe(true);
    expect(statusCode).toBe(401);
    expect(ended).toBe(true);
  });

  it("allows upgrades when cookie matches", async () => {
    const { createAccessGate } = await import("../../server/access-gate");
    const gate = createAccessGate({ token: "abc" });
    expect(
      gate.allowUpgrade({ headers: { cookie: "studio_access=abc" } })
    ).toBe(true);
  });

  it("returns 429 after repeated failed attempts", async () => {
    const { createAccessGate } = await import("../../server/access-gate");
    const gate = createAccessGate({ token: "abc" });

    const createResponse = () => {
      let statusCode = 0;
      let body = "";
      return {
        setHeader: () => {},
        end: (value?: string) => {
          body = value ?? "";
        },
        get statusCode() {
          return statusCode;
        },
        set statusCode(value: number) {
          statusCode = value;
        },
        get body() {
          return body;
        },
      };
    };

    for (let index = 0; index < 9; index++) {
      const res = createResponse();
      gate.handleHttp(
        { url: "/api/studio", headers: {}, socket: { remoteAddress: "127.0.0.1" } },
        res
      );
      expect(res.statusCode).toBe(401);
    }

    const limited = createResponse();
    gate.handleHttp(
      { url: "/api/studio", headers: {}, socket: { remoteAddress: "127.0.0.1" } },
      limited
    );

    expect(limited.statusCode).toBe(429);
    expect(limited.body).toContain("Too many failed studio access attempts");
  });

  it("recovers immediately when a valid cookie is sent after throttling", async () => {
    const { createAccessGate } = await import("../../server/access-gate");
    const gate = createAccessGate({ token: "abc" });

    const createResponse = () => {
      let statusCode = 0;
      let body = "";
      return {
        setHeader: () => {},
        end: (value?: string) => {
          body = value ?? "";
        },
        get statusCode() {
          return statusCode;
        },
        set statusCode(value: number) {
          statusCode = value;
        },
        get body() {
          return body;
        },
      };
    };

    for (let index = 0; index < 10; index++) {
      const res = createResponse();
      gate.handleHttp(
        { url: "/api/studio", headers: {}, socket: { remoteAddress: "127.0.0.1" } },
        res
      );
    }

    expect(
      gate.allowUpgrade({
        headers: { cookie: "studio_access=abc" },
        socket: { remoteAddress: "127.0.0.1" },
      })
    ).toBe(true);

    const recovered = createResponse();
    gate.handleHttp(
      {
        url: "/api/studio",
        headers: { cookie: "studio_access=abc" },
        socket: { remoteAddress: "127.0.0.1" },
      },
      recovered
    );

    expect(recovered.statusCode).toBe(0);

    const afterReset = createResponse();
    gate.handleHttp(
      { url: "/api/studio", headers: {}, socket: { remoteAddress: "127.0.0.1" } },
      afterReset
    );

    expect(afterReset.statusCode).toBe(401);
    expect(afterReset.body).toContain("Studio access token required");
  });

  it("serves the localhost studio access helper page", async () => {
    const { createAccessGate } = await import("../../server/access-gate");
    const gate = createAccessGate({ token: "abc" });
    const res = createResponse();

    const handled = gate.handleLocalAccessHttp(
      {
        method: "GET",
        url: "/studio-access?redirect=%2Foffice",
        headers: { host: "localhost:3006" },
        socket: { remoteAddress: "127.0.0.1" },
      },
      res
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(res.body).toContain("Unlock Studio");
    expect(res.body).toContain('value="/office"');
  });

  it("rejects helper requests when the host is loopback but the socket is not", async () => {
    const { createAccessGate } = await import("../../server/access-gate");
    const gate = createAccessGate({ token: "abc" });
    const res = createResponse();

    const handled = gate.handleLocalAccessHttp(
      {
        method: "GET",
        url: "/studio-access",
        headers: { host: "localhost:3006" },
        socket: { remoteAddress: "203.0.113.5" },
      },
      res
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("Not found");
  });

  it("allows loopback-host helper requests from Docker when explicitly enabled", async () => {
    const previous = process.env.STUDIO_ACCESS_LOCAL_HELPER;
    process.env.STUDIO_ACCESS_LOCAL_HELPER = "1";

    try {
      const modulePath = requireAccessGate.resolve("../../server/access-gate");
      delete requireAccessGate.cache[modulePath];
      const { createAccessGate } = requireAccessGate("../../server/access-gate");
      const gate = createAccessGate({ token: "abc" });
      const res = createResponse();

      const handled = gate.handleLocalAccessHttp(
        {
          method: "GET",
          url: "/studio-access",
          headers: { host: "localhost:3006" },
          socket: { remoteAddress: "172.18.0.1" },
        },
        res
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("Unlock Studio");
    } finally {
      if (typeof previous === "string") {
        process.env.STUDIO_ACCESS_LOCAL_HELPER = previous;
      } else {
        delete process.env.STUDIO_ACCESS_LOCAL_HELPER;
      }
    }
  });

  it("rejects the helper path for non-local hosts", async () => {
    const { createAccessGate } = await import("../../server/access-gate");
    const gate = createAccessGate({ token: "abc" });
    const res = createResponse();

    const handled = gate.handleLocalAccessHttp(
      {
        method: "GET",
        url: "/studio-access",
        headers: { host: "studio.example.com" },
        socket: { remoteAddress: "203.0.113.5" },
      },
      res
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("Not found");
  });

  it("sets the studio access cookie after a valid localhost POST", async () => {
    const { createAccessGate } = await import("../../server/access-gate");
    const gate = createAccessGate({ token: "abc" });
    const req = createStreamRequest({
      method: "POST",
      url: "/studio-access",
      headers: {
        host: "localhost:3006",
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    const res = createResponse();

    const handled = gate.handleLocalAccessHttp(req, res);
    req.end("token=abc&redirect=%2Foffice");
    await res.ended;

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(303);
    expect(res.headers.Location).toBe("/office");
    expect(res.headers["Set-Cookie"]).toContain("studio_access=abc");
    expect(res.headers["Set-Cookie"]).toContain("HttpOnly");
  });

  it("clears the studio access cookie via localhost POST", async () => {
    const { createAccessGate } = await import("../../server/access-gate");
    const gate = createAccessGate({ token: "abc" });
    const req = createStreamRequest({
      method: "POST",
      url: "/studio-access",
      headers: {
        host: "localhost:3006",
        cookie: "studio_access=abc",
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    const res = createResponse();

    const handled = gate.handleLocalAccessHttp(req, res);
    req.end("action=clear&redirect=%2Foffice");
    await res.ended;

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(303);
    expect(res.headers.Location).toBe("/studio-access?redirect=%2Foffice&notice=cleared");
    expect(res.headers["Set-Cookie"]).toContain("studio_access=");
    expect(res.headers["Set-Cookie"]).toContain("Max-Age=0");
  });
});
