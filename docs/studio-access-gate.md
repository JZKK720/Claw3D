# Studio Access Gate

When `STUDIO_ACCESS_TOKEN` is set, Claw3D expects a cookie named `studio_access` with the same value before it will serve the UI or API routes.

## Localhost helper

For local development, Docker, and other direct localhost workflows, open the helper path in your browser:

- `http://localhost:3000/studio-access`

Enter the same value you configured for `STUDIO_ACCESS_TOKEN`. Claw3D will set the `studio_access` cookie and redirect you back into the app.

If you need to rotate or remove the cookie, revisit `/studio-access` while the cookie is present and use the clear button. Claw3D will expire the cookie and keep you on the helper so you can enter a new token.

Notes:

- The helper only responds to direct loopback requests. It requires both a loopback host header such as `localhost` and a direct loopback socket address such as `127.0.0.1` or `::1`.
- If you need the helper through a local Docker bridge, enable `STUDIO_ACCESS_LOCAL_HELPER=1` and keep the published host bind local.
- The cookie is set as `HttpOnly` and `SameSite=Lax`.
- If you terminate TLS at a reverse proxy, Claw3D will add `Secure` when it can trust `X-Forwarded-Proto=https` via `TRUSTED_PROXY=1`.

## Reverse proxy helper snippets

For non-local deployments, keep provisioning the cookie in your auth or proxy layer instead of relying on the built-in helper.

### Caddy

Use a dedicated helper path at the proxy layer so the cookie never needs to be typed in the browser:

```caddyfile
studio.example.com {
  @studioAccess path /studio-access

  handle @studioAccess {
    header Set-Cookie "studio_access=<YOUR_STUDIO_ACCESS_TOKEN>; Path=/; HttpOnly; SameSite=Lax; Secure"
    redir / 303
  }

  reverse_proxy 127.0.0.1:3000
}
```

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name studio.example.com;

    location = /studio-access {
        add_header Set-Cookie "studio_access=<YOUR_STUDIO_ACCESS_TOKEN>; Path=/; HttpOnly; SameSite=Lax; Secure" always;
        return 303 /;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Operational notes:

- Keep the token in secret storage or deployment templating; do not hardcode it in tracked config files.
- If you serve plain HTTP on a trusted local network, remove `Secure` from the cookie attributes.
- If the proxy handles `/studio-access` itself, it does not need to forward that path to Claw3D.
- Do not enable `STUDIO_ACCESS_LOCAL_HELPER=1` on a publicly reachable bind unless you also place an equivalent access control boundary in front of it.
