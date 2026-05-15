# Agent Instructions

Keep repository instructions generic and safe for open source.

This repo is a frontend for OpenClaw. Keep any OpenClaw runtime checkout separate from this repository.

Do not modify the OpenClaw source code. When the user asks for changes, they are asking for changes to this app. Your solutions should be applied to this app but to understand the full context of implementing your solution, you will need to search through OpenClaw's source code.

If you use local private overlay instructions, keep them outside the repository and do not commit them here.

Do not commit personal, environment-specific, or secret instructions to this repository.

## Service overview

Claw3D is a Next.js 16 frontend (TypeScript, React 19, Three.js, Phaser) for OpenClaw. It runs a custom Node.js server (`server/index.js`) that bundles a same-origin WebSocket proxy to the upstream OpenClaw Gateway. No database or Docker is required. The only hard system dependency is Node.js 20+ with npm 10+.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system model and core boundaries.

## Commands

```sh
npm run dev              # dev server on :3000 via custom Node server
npm run dev:https        # dev server with self-signed HTTPS
npm run build            # Next.js production build
npm run start            # production server

npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run test -- --run    # Vitest unit tests (always pass --run; default is watch mode)
npm run e2e              # Playwright E2E (requires: npx playwright install)
npm run smoke:dev-server # start on random port and verify HTTP

npm run doctor           # claw3doctor diagnostics CLI (profile-scoped, JSON output)
npm run cleanup:ux-artifacts  # remove generated UX audit files
```

- `npm run studio:setup` is interactive (TTY) — avoid in non-interactive environments.
- `.env` is copied from `.env.example`; see `README.md` "Configuration" for variable descriptions.

## Architecture summary

```
Browser (Next.js client)
  └─ WebSocket → /api/gateway/ws
       └─ server/gateway-proxy.js → upstream OpenClaw Gateway
```

- `src/app/` — Next.js 16 route tree. `page.tsx` is a Server Component; imports client-rendered feature screens.
- `src/features/` — Feature-scoped modules: `agents/`, `office/`, `retro-office/`, `company-builder/`, `onboarding/`, `spotify-jukebox/`. All feature components use `"use client"`.
- `src/lib/` — Shared utilities with no UI (agent-state, gateway, runtime, security, skills, studio, tasks, …).
- `src/hooks/` — Cross-feature hooks (voice, office preferences, assistant reply listeners).
- `server/` — CommonJS Node.js server files. Uses `require()`, not ESM `import`.

## Code conventions

- **Path alias:** `@/*` → `src/*` (configured in `tsconfig.json`).
- **Client components:** All feature components begin with `"use client"`. Server Components are limited to `layout.tsx`, `page.tsx`, and API routes.
- **State management:** React Context + `useReducer` (no Redux/Zustand). Gateway state flows through `useGatewayConnection()` → `useRuntimeConnection()`.
- **Gateway frame protocol:** `{ type: "req"|"res"|"event", id, method, params, payload, error }`. Use `GatewayClient` in `src/lib/gateway/`; do not open WebSockets directly from components.
- **API routes:** `src/app/api/[feature]/[action]/route.ts`, exporting `GET`, `POST`, etc.
- **Tests:** Co-locate unit tests as `module.test.ts` / `module.test.tsx` next to the source file. E2E specs live in `tests/e2e/`.
- **Runtime profiles:** Named backends (`openclaw`, `hermes`, `demo`, `local`, `claw3d`, `custom`) with per-profile URL/token stored in Studio settings. See [docs/integrations/runtime-profile-architecture.md](docs/integrations/runtime-profile-architecture.md).

## Pre-existing issues (do not fix unless asked)

- One ESLint error in `src/features/retro-office/RetroOffice3D.tsx`.
- Type errors in `tests/unit/agentChatPanel-*.test.ts` (stale `onOpenSettings` prop).
- A few Vitest unit test failures.
- `npm run build` warns `Can't resolve 'openclaw'` — harmless; the package is resolved at runtime, not bundled.

## Studio settings

Studio reads gateway URL, token, and office layout from `~/.openclaw` (falls back to `~/.moltbot` / `~/.clawdbot`). These are server-only; client code must go through `/api/studio`.

## Key documentation

| Doc | Topic |
|-----|-------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System model, boundaries, main flows |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, PR guidelines, issue template |
| [CODE_DOCUMENTATION.md](CODE_DOCUMENTATION.md) | Repo map and onboarding reading order |
| [ROADMAP.md](ROADMAP.md) | Planned work and starter tasks |
| [SECURITY_HARDENING.md](SECURITY_HARDENING.md) | CSP, access gate, headers |
| [docs/integrations/custom-runtime-provider-spec.md](docs/integrations/custom-runtime-provider-spec.md) | Adding custom runtime backends |
| [docs/integrations/runtime-profile-architecture.md](docs/integrations/runtime-profile-architecture.md) | Profile persistence and multi-floor binding |
| [docs/hermes-gateway.md](docs/hermes-gateway.md) | Hermes multi-agent orchestrator protocol |
