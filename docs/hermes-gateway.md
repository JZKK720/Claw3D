# Hermes Gateway Adapter

Claw3D can run against Hermes by using the bundled adapter in
[`server/hermes-gateway-adapter.js`](../server/hermes-gateway-adapter.js).

This is the current production-ready Hermes path in this repository.
It is not yet a fully native Studio-side Hermes provider. Instead, it
uses the runtime seam in Studio while Hermes is exposed through a
Claw3D-compatible WebSocket adapter.

## Architecture

```text
Browser UI <-> Studio runtime/client <-> Hermes gateway adapter <-> Hermes HTTP API
```

The frontend keeps using the Claw3D gateway protocol. The Hermes adapter
translates that protocol into Hermes HTTP calls and streams the results
back as gateway events.

## Quick start

### 1. Start Hermes

Start your Hermes API server. The default expected endpoint is:

```text
http://localhost:8642
```

### 2. Configure environment

Copy `.env.example` to `.env` and set the Hermes values:

```env
NEXT_PUBLIC_GATEWAY_URL=ws://localhost:18791

HERMES_API_URL=http://localhost:8642
HERMES_API_KEY=
HERMES_ADAPTER_PORT=18791
HERMES_MODEL=hermes
HERMES_AGENT_NAME=Hermes
```

### 3. Start Claw3D and the adapter

In separate terminals:

```bash
npm run hermes-adapter
npm run dev
```

Then open `http://localhost:3000` and connect to:

```text
ws://localhost:18791
```

In the connect screen, select `Hermes backend`. Claw3D will persist that
selection in Studio settings and show `Hermes` as the active backend once
the adapter hello response is received.

### 4. Optional all-in-one local startup

The repo also includes:

```bash
bash scripts/clawd3d-start.sh
```

That script now resolves the repo root dynamically from the script
location instead of assuming a machine-specific checkout path.

## What this adapter supports

The adapter currently supports the Claw3D surfaces needed for normal
office use:

- Agent listing, creation, update, and deletion
- Session listing, preview, patch, reset, and history lookup
- Chat send, targeted abort, and run wait
- Config get/set/patch shims needed by the Studio UI
- Models and skills status
- Exec approvals surfaces used by the current UI
- Cron list/add/remove/patch/run
- Multi-agent orchestration tools on the Hermes side

## Hermes orchestration tools

The main Hermes agent acts as an orchestrator with these tools:

| Tool | Description |
|---|---|
| `spawn_agent` | Create a specialist sub-agent |
| `delegate_task` | Send work to a specific agent |
| `list_team` | List active agents, names, and roles |
| `configure_agent` | Update agent name, role, instructions, or settings |
| `dismiss_agent` | Remove an agent from the team |
| `read_agent_context` | Read another agent's recent conversation history for coordination |

Sub-agents appear in the office as separate characters and keep their
own conversation state.

## Production-readiness notes

This adapter includes the fixes that blocked the original Hermes PR:

- `chat.abort` now aborts only the requested `runId` or `sessionKey`
  instead of cancelling every active run
- history clears from `sessions.reset`, `agents.delete`, and
  `dismiss_agent` now persist to disk immediately
- `scripts/clawd3d-start.sh` no longer hardcodes one developer's local path

## ACP status

Hermes has a real ACP surface and that remains the preferred long-term
integration direction.

This branch does not replace the adapter with ACP yet. The current
production-ready path uses the adapter because it works with the existing
Claw3D gateway contract today and is ready for upstream testing now.

The runtime seam added in Studio is what makes an ACP-backed Hermes
provider feasible as a follow-up without reworking the whole UI again.

## Docker-hosted Claw3D + containerized Hermes

If Claw3D runs in Docker but the Hermes API runs in a separate container with a host-published port,
keep the Hermes API URL pointed at the host from the adapter process, and keep Claw3D pointed at the
adapter WebSocket, not the raw Hermes API.

Example split:

```env
# Used by the bundled adapter process (host-run or Docker sidecar)
HERMES_API_URL=http://127.0.0.1:8789
# Used by the Docker sidecar specifically
HERMES_ADAPTER_API_URL=http://host.docker.internal:8789
# Optional if the Hermes API requires auth
HERMES_API_KEY_FILE=.secrets/hermes-api-key

# Used by Claw3D running in Docker
HERMES_ADAPTER_HOST=host.docker.internal
HERMES_ADAPTER_PORT=18791
```

In that shape, Claw3D talks to `ws://host.docker.internal:18791`, and the adapter talks to the
Hermes API on `http://127.0.0.1:8789`.

If you use this repo's Docker Compose workflow, `docker compose up -d` now starts the adapter as a
sidecar service and mounts `.secrets/` into the container so `HERMES_API_KEY_FILE=.secrets/hermes-api-key`
works without putting the API key into `.env`.

## Persistence

Conversation history is stored at:

```text
~/.hermes/clawd3d-history.json
```

It is loaded on startup and updated when conversations change.

## Current limitations

- Hermes is integrated through the adapter path today, not yet through a
  dedicated native Studio provider implementation
- Config and approvals behavior still matches the current adapter contract,
  not a fully Hermes-native settings model
- This path is intended to get Hermes working reliably now while the
  broader runtime-provider architecture continues to mature

## When to use demo mode instead

If you only want to see the office boot without installing Hermes or
OpenClaw, use:

```bash
npm run demo-gateway
npm run dev
```

That starts a bundled mock gateway for a no-framework Claw3D demo.

## Using OpenClaw instead

If you want the OpenClaw path, do not run the Hermes adapter. Start
OpenClaw and point Claw3D at that gateway instead.
