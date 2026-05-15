# Security Policy

## Reporting A Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Preferred path:

- If the repository host exposes private vulnerability reporting or GitHub Security Advisories for this repo, use that path first.

Fallback path:

- If no private reporting channel is available, open a minimal public issue requesting a private contact channel and do not include exploit details, tokens, or proof-of-concept payloads in that issue.

When reporting a vulnerability, include:

- A clear description of the issue.
- Impact and affected areas.
- Reproduction steps or a proof of concept.
- Any suggested mitigation if you have one.

We aim to acknowledge reports promptly, investigate them, and coordinate a fix and disclosure timeline with the reporter.

## Current Security Limitations

- Studio gateway settings are stored on disk in plaintext under the local OpenClaw state directory.
- The current UI loads the configured upstream gateway URL/token into browser memory at runtime, even though those values are not stored in browser persistent storage.
- Claw3D now exposes a minimal localhost helper at `/studio-access` that can set or clear the `studio_access` cookie after the configured token is entered, but there is still no general-purpose remote login flow for `STUDIO_ACCESS_TOKEN`.

## Scope

Please report issues related to:

- Authentication or access-control bypasses.
- Secret handling or token exposure.
- Remote code execution or privilege escalation paths.
- Unsafe filesystem, proxy, or network behavior.
- Dependency vulnerabilities that materially affect this project.

## Deployment Notes

- In production, set `UPSTREAM_ALLOWLIST` for the Studio gateway proxy.
- In production, set `CUSTOM_RUNTIME_ALLOWLIST` if you use `/api/runtime/custom`. If unset, it falls back to `UPSTREAM_ALLOWLIST`.
- Empty allowlists are intended for local development only.
- If you enable `STUDIO_ACCESS_TOKEN` on direct localhost access, you can use `/studio-access` to set or clear the cookie in-browser.
- If you enable `STUDIO_ACCESS_TOKEN` for a non-local deployment, you must still provision the `studio_access` cookie through your deployment/auth layer. See [docs/studio-access-gate.md](docs/studio-access-gate.md) for proxy examples.
- `STUDIO_ACCESS_LOCAL_HELPER=1` is intended for loopback-bound local Docker workflows only. Do not enable it on publicly reachable binds.
