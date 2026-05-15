const crypto = require("node:crypto");


const STUDIO_ACCESS_HELPER_PATH = "/studio-access";


const parseCookies = (header) => {
  const raw = typeof header === "string" ? header : "";
  if (!raw.trim()) return {};
  const out = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const resolvePathname = (url) => {
  const raw = typeof url === "string" ? url : "";
  const idx = raw.indexOf("?");
  return (idx === -1 ? raw : raw.slice(0, idx)) || "/";
};

const parseRequestUrl = (url) => {
  try {
    return new URL(typeof url === "string" ? url : "/", "http://localhost");
  } catch {
    return new URL("/", "http://localhost");
  }
};

const normalizeHostHeader = (value) => {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) return "";

  const first = raw.split(",")[0]?.trim() || "";
  if (!first) return "";

  if (first.startsWith("[")) {
    const end = first.indexOf("]");
    return end === -1 ? first : first.slice(1, end);
  }

  const colonCount = (first.match(/:/g) || []).length;
  if (colonCount > 1) return first;
  return first.split(":")[0] || "";
};

const normalizeIp = (value) => {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) return "";
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
};

const isLoopbackHost = (value) => {
  const host = normalizeHostHeader(value);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
};

const isLoopbackIp = (value) => {
  const ip = normalizeIp(value);
  return ip === "127.0.0.1" || ip === "::1";
};

const isSafeRedirect = (value) =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//");

const resolveRedirect = (value) => (isSafeRedirect(value) ? value : "/");

const shouldSetSecureCookie = (req) => {
  if (req.socket?.encrypted) return true;
  if (process.env.TRUSTED_PROXY !== "1") return false;
  const forwarded = req.headers?.["x-forwarded-proto"];
  return typeof forwarded === "string" && forwarded.split(",")[0]?.trim() === "https";
};

const buildAccessCookie = (req, cookieName, token) => {
  const parts = [`${cookieName}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (shouldSetSecureCookie(req)) parts.push("Secure");
  return parts.join("; ");
};

const buildClearedAccessCookie = (req, cookieName) => {
  const parts = [
    `${cookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (shouldSetSecureCookie(req)) parts.push("Secure");
  return parts.join("; ");
};

const resolveHelperNotice = (value) => {
  if (value === "cleared") {
    return "Studio access cookie cleared. Enter the token again to unlock Studio.";
  }
  return "";
};

const buildHelperLocation = ({ redirect = "/", notice = "" } = {}) => {
  const params = new URLSearchParams();
  const safeRedirect = resolveRedirect(redirect);
  if (safeRedirect !== "/") params.set("redirect", safeRedirect);
  if (notice) params.set("notice", notice);
  const query = params.toString();
  return query ? `${STUDIO_ACCESS_HELPER_PATH}?${query}` : STUDIO_ACCESS_HELPER_PATH;
};

const renderAccessHelperPage = ({ error = "", notice = "", redirect = "/", canClear = false } = {}) => {
  const message = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const banner = notice ? `<p class="notice">${escapeHtml(notice)}</p>` : "";
  const safeRedirect = escapeHtml(resolveRedirect(redirect));
  const clearForm = canClear
    ? `<form method="post" action="${STUDIO_ACCESS_HELPER_PATH}">
        <input type="hidden" name="action" value="clear" />
        <input type="hidden" name="redirect" value="${safeRedirect}" />
        <button class="secondary" type="submit">Clear Cookie</button>
      </form>`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unlock Studio</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(160deg, #141a23 0%, #243445 100%);
        font-family: "Segoe UI", sans-serif;
        color: #f5f7fa;
      }
      main {
        width: min(28rem, calc(100vw - 2rem));
        padding: 1.5rem;
        border-radius: 1rem;
        background: rgba(15, 23, 42, 0.88);
        box-shadow: 0 1.5rem 4rem rgba(15, 23, 42, 0.35);
      }
      h1 { margin-top: 0; margin-bottom: 0.75rem; font-size: 1.6rem; }
      p { margin: 0 0 1rem; line-height: 1.5; }
      label { display: block; margin-bottom: 0.5rem; font-weight: 600; }
      input {
        width: 100%;
        box-sizing: border-box;
        padding: 0.8rem 0.9rem;
        border-radius: 0.75rem;
        border: 1px solid rgba(148, 163, 184, 0.4);
        background: rgba(15, 23, 42, 0.65);
        color: inherit;
      }
      button {
        margin-top: 1rem;
        width: 100%;
        padding: 0.85rem 1rem;
        border: 0;
        border-radius: 999px;
        background: #f59e0b;
        color: #111827;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .secondary {
        background: transparent;
        color: #f5f7fa;
        border: 1px solid rgba(148, 163, 184, 0.45);
      }
      .error {
        padding: 0.8rem 0.9rem;
        border-radius: 0.75rem;
        background: rgba(220, 38, 38, 0.18);
        border: 1px solid rgba(248, 113, 113, 0.45);
      }
      .notice {
        padding: 0.8rem 0.9rem;
        border-radius: 0.75rem;
        background: rgba(34, 197, 94, 0.16);
        border: 1px solid rgba(74, 222, 128, 0.35);
      }
      .hint {
        font-size: 0.95rem;
        color: rgba(226, 232, 240, 0.9);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Unlock Studio</h1>
      <p class="hint">Use this helper on localhost to set or clear the <code>studio_access</code> cookie for local Docker testing.</p>
      ${banner}
      ${message}
      <form method="post" action="${STUDIO_ACCESS_HELPER_PATH}">
        <input type="hidden" name="redirect" value="${safeRedirect}" />
        <label for="token">Studio access token</label>
        <input id="token" name="token" type="password" autocomplete="current-password" autofocus required />
        <button type="submit">Set Cookie and Continue</button>
      </form>
      ${clearForm}
    </main>
  </body>
</html>`;
};

/** Constant-time string comparison to prevent timing attacks. */
const safeCompare = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Compare against self to burn constant time, then return false
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
};

/** Simple in-memory rate limiter for auth attempts. */
const createRateLimiter = (maxAttempts = 10, windowMs = 60_000) => {
  const attempts = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      if (now - entry.start > windowMs) attempts.delete(key);
    }
  }, windowMs);
  cleanup.unref();

  return {
    isLimited(ip) {
      const entry = attempts.get(ip);
      if (!entry) return false;
      return entry.count >= maxAttempts;
    },
    recordFailure(ip) {
      const now = Date.now();
      const entry = attempts.get(ip);
      if (!entry || now - entry.start > windowMs) {
        attempts.set(ip, { count: 1, start: now });
        return;
      }
      entry.count++;
    },
    reset(ip) {
      attempts.delete(ip);
    },
  };
};

/**
 * Resolve client IP for rate limiting.
 * When TRUSTED_PROXY=1 is set, the first value of X-Forwarded-For is used.
 * Only set TRUSTED_PROXY=1 when this server sits behind a reverse proxy that
 * you control (nginx, Caddy, Vercel edge). Without it, X-Forwarded-For is
 * ignored to prevent spoofing by direct clients.
 */
const resolveClientIp = (req) => {
  if (process.env.TRUSTED_PROXY === "1") {
    const forwarded = req.headers?.["x-forwarded-for"];
    if (typeof forwarded === "string") {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
  }
  return req.socket?.remoteAddress || "unknown";
};

function createAccessGate(options) {
  const token = String(options?.token ?? "").trim();
  const cookieName = String(options?.cookieName ?? "studio_access").trim() || "studio_access";
  const allowLocalhostHelperFromDocker = process.env.STUDIO_ACCESS_LOCAL_HELPER === "1";

  const enabled = Boolean(token);
  const rateLimiter = createRateLimiter(10, 60_000);

  const getAttemptState = (req, candidateToken) => {
    if (!enabled) return { authorized: true, limited: false };
    const ip = resolveClientIp(req);
    const authorized = safeCompare(candidateToken || "", token);
    if (authorized) {
      rateLimiter.reset(ip);
      return { authorized: true, limited: false };
    }
    if (rateLimiter.isLimited(ip)) {
      return { authorized: false, limited: true };
    }
    rateLimiter.recordFailure(ip);
    return { authorized: false, limited: rateLimiter.isLimited(ip) };
  };

  const getAuthState = (req) => {
    if (!enabled) return { authorized: true, limited: false };
    const cookieHeader = req.headers?.cookie;
    const cookies = parseCookies(cookieHeader);
    return getAttemptState(req, cookies[cookieName] || "");
  };

  const isDirectLoopbackRequest = (req) => isLoopbackIp(req.socket?.remoteAddress);

  const isLocalAccessRequest = (req) =>
    isLoopbackHost(req.headers?.host) &&
    (isDirectLoopbackRequest(req) || allowLocalhostHelperFromDocker);

  const respondWithHelperPage = (
    req,
    res,
    { statusCode = 200, error = "", notice = "", redirect = "/", canClear = false } = {}
  ) => {
    const body = renderAccessHelperPage({ error, notice, redirect, canClear });
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(req.method === "HEAD" ? "" : body);
  };

  const handleLocalAccessHttp = (req, res) => {
    if (!enabled) return false;
    if (resolvePathname(req.url) !== STUDIO_ACCESS_HELPER_PATH) return false;

    if (!isLocalAccessRequest(req)) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not found.");
      return true;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      const requestUrl = parseRequestUrl(req.url);
      const redirect = resolveRedirect(requestUrl.searchParams.get("redirect") || "/");
      const cookies = parseCookies(req.headers?.cookie);
      respondWithHelperPage(req, res, {
        redirect,
        notice: resolveHelperNotice(requestUrl.searchParams.get("notice") || ""),
        canClear: typeof cookies[cookieName] === "string" && cookies[cookieName].length > 0,
      });
      return true;
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD, POST");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method not allowed.");
      return true;
    }

    const chunks = [];
    let size = 0;
    let finished = false;

    const finish = (callback) => {
      if (finished) return;
      finished = true;
      callback();
    };

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 8192) {
        finish(() => {
          res.statusCode = 413;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Payload too large.");
        });
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on("error", () => {
      finish(() => {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Invalid request body.");
      });
    });

    req.on("end", () => {
      finish(() => {
        const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        const redirect = resolveRedirect(params.get("redirect") || "/");
        const action = params.get("action") || "set";
        if (action === "clear") {
          res.statusCode = 303;
          res.setHeader("Location", buildHelperLocation({ redirect, notice: "cleared" }));
          res.setHeader("Set-Cookie", buildClearedAccessCookie(req, cookieName));
          res.end("Studio access cookie cleared.");
          return;
        }

        const auth = getAttemptState(req, params.get("token") || "");
        if (!auth.authorized) {
          respondWithHelperPage(req, res, {
            statusCode: auth.limited ? 429 : 401,
            error: auth.limited
              ? "Too many failed studio access attempts. Wait a minute and retry."
              : "Studio access token did not match.",
            redirect,
            canClear: typeof parseCookies(req.headers?.cookie)[cookieName] === "string",
          });
          return;
        }

        res.statusCode = 303;
        res.setHeader("Location", redirect);
        res.setHeader("Set-Cookie", buildAccessCookie(req, cookieName, token));
        res.end("Studio access cookie set.");
      });
    });

    return true;
  };

  const handleHttp = (req, res) => {
    if (!enabled) return false;
    const auth = getAuthState(req);
    if (!auth.authorized) {
      const statusCode = auth.limited ? 429 : 401;
      if (String(req.url || "/").startsWith("/api/")) {
        res.statusCode = statusCode;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            error: auth.limited
              ? "Too many failed studio access attempts. Wait a minute and retry."
              : "Studio access token required. Send the configured Studio access cookie and retry.",
          })
        );
      } else {
        res.statusCode = statusCode;
        res.setHeader("Content-Type", "text/plain");
        res.end(
          auth.limited
            ? "Too many failed studio access attempts. Wait a minute and retry."
            : "Studio access token required. Set the studio_access cookie to access this page."
        );
      }
      return true;
    }
    return false;
  };

  const allowUpgrade = (req) => {
    if (!enabled) return true;
    return getAuthState(req).authorized;
  };

  return { enabled, handleLocalAccessHttp, handleHttp, allowUpgrade };
}

module.exports = { createAccessGate };
