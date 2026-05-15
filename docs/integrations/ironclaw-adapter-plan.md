# IronClaw Adapter Plan

> Implementation map and target architecture for adding a dedicated IronClaw adapter to Claw3D while OpenClaw, Hermes, and IronClaw run in separate containers.

## Position

Claw3D should remain the UI and control plane.

It should not absorb OpenClaw, Hermes, and IronClaw into one monolithic runtime process. The better fit for this repository is:

- OpenClaw remains its own gateway/runtime container
- Hermes remains its own runtime container, optionally fronted by a Claw3D-compatible adapter container
- IronClaw should be added as its own dedicated adapter path, not forced through the generic `custom` path
- Studio keeps one same-origin browser boundary and routes to whichever runtime profile is selected

That matches the current repo architecture and the existing runtime seam.

## Current Container Topology

The stated deployment shape is already close to the right long-term model:

```text
Browser
  -> Claw3D container
       -> selected upstream runtime container
          -> OpenClaw gateway container
          -> Hermes adapter/runtime container
          -> IronClaw adapter/runtime container
```

Recommended interpretation:

- Claw3D does not start or supervise those runtime containers
- Claw3D stores connection profiles and selected adapter identity
- each runtime container exposes one stable Claw3D-facing boundary

For OpenClaw and Hermes that boundary already exists today.

For IronClaw, the recommended boundary is a dedicated adapter that speaks the same Claw3D gateway contract expected by the current WebSocket path.

## Recommended Near-Term Path

### Phase 1: Dedicated IronClaw adapter

Add IronClaw as a new first-class adapter type beside `openclaw`, `hermes`, and `demo`.

The adapter should:

- expose a WebSocket interface compatible with the current Studio gateway proxy flow
- return `hello.adapterType = "ironclaw"`
- map IronClaw-native APIs or runtime events into the Claw3D gateway frame contract
- claim capabilities conservatively until each surface is proven stable

This keeps the browser and most of Studio unchanged while making IronClaw selectable and honest.

### Phase 2: Universal runtime service inside Studio

Once IronClaw is working through a dedicated adapter, Studio can be refactored toward a backend-neutral runtime router:

```text
Browser UI
  -> Claw3D same-origin runtime service
       -> OpenClaw provider
       -> Hermes provider
       -> IronClaw provider
```

The browser should continue to see one stable Claw3D-facing control plane.

Provider-specific logic should stay behind provider adapters rather than leaking into the UI.

## Exact Code Surfaces

These are the concrete files that matter for a dedicated IronClaw adapter in this repository.

### 1. Adapter implementation template

- `server/hermes-gateway-adapter.js`
  - best template for a real provider-backed adapter
  - already translates non-OpenClaw runtime behavior into Claw3D gateway frames
  - use this as the starting shape for `server/ironclaw-gateway-adapter.js`

- `server/demo-gateway-adapter.js`
  - useful as the smallest reference implementation for the WebSocket frame contract
  - helpful for the minimum required `hello`, request/response, and event broadcast behavior

Recommended new file:

- `server/ironclaw-gateway-adapter.js`

Recommended env surface:

- `IRONCLAW_API_URL`
- `IRONCLAW_API_KEY`
- `IRONCLAW_ADAPTER_PORT`
- `IRONCLAW_AGENT_NAME`
- `IRONCLAW_MODEL`

### 2. Studio proxy boundary

- `server/index.js`
  - current same-origin WebSocket entry point at `/api/gateway/ws`
  - no required near-term change if IronClaw remains an external adapter endpoint
  - becomes important in Phase 2 if Studio grows a provider router instead of a plain upstream passthrough

- `server/gateway-proxy.js`
  - current upstream WebSocket proxy and connect-flow policy enforcement
  - near term: mostly unchanged if the IronClaw adapter speaks the same gateway contract as Hermes/OpenClaw
  - later: likely home for adapter-aware routing rules, capability handshake normalization, or upstream protocol cleanup

- `server/studio-settings.js`
  - currently biased toward OpenClaw defaults when no token is configured
  - likely needs follow-up if IronClaw should get automatic local/container defaults instead of manual URL entry only

### 3. Studio adapter identity and profile storage

- `src/lib/studio/settings.ts`
  - add `"ironclaw"` to `StudioGatewayAdapterType`
  - add `"ironclaw"` to `STUDIO_GATEWAY_ADAPTER_TYPES`
  - include `ironclaw` in normalization loops and profile resolution
  - add default profile logic for IronClaw if it should auto-fill a local container endpoint
  - current default profile logic is in `resolveDefaultStudioGatewayProfile()`

Why this file matters:

- it is the source of truth for selected adapter identity
- it controls saved profiles and last-known-good behavior
- it determines whether IronClaw feels like a first-class runtime instead of a stringly-typed afterthought

### 4. Gateway client behavior and connect flow

- `src/lib/gateway/GatewayClient.ts`
  - add `ironclaw` wherever adapter types are normalized
  - decide whether IronClaw is an auto-managed adapter like Hermes and Demo
  - update hello adapter type detection
  - update local profile handling and retry behavior if IronClaw should auto-connect locally
  - decide whether IronClaw should disable OpenClaw-specific device auth like Hermes does

Key near-term decisions in this file:

- whether `ironclaw` belongs in `isAutoManagedAdapter()`
- whether it should get the same delayed initial connection semantics as Hermes/Demo
- whether it should use the control UI client name without OpenClaw device auth semantics

### 5. Runtime provider seam

- `src/lib/runtime/types.ts`
  - add `"ironclaw"` to `RuntimeProviderId`
  - define a conservative initial capability set for IronClaw

- `src/lib/runtime/createRuntimeProvider.ts`
  - add `IronClawRuntimeProvider`
  - route `adapterType === "ironclaw"` to that provider

- `src/lib/runtime/ironclaw/provider.ts`
  - new file
  - provider-local capability declaration
  - provider-local method overrides if IronClaw needs special handling for direct messages, handoffs, or session mapping
  - provider-local runtime event normalization

Recommended near-term provider shape:

- follow `HermesRuntimeProvider` if the IronClaw adapter already emits gateway-like events
- only fall back toward `CustomRuntimeProvider` behavior if IronClaw stays HTTP-native and the adapter is intentionally thin

### 6. UI adapter picker and runtime hints

- `src/features/agents/components/GatewayConnectScreen.tsx`
  - add an IronClaw preset option
  - add IronClaw-specific hint text
  - decide whether token entry is optional or required for the IronClaw adapter

- `src/features/agents/screens/AgentsPageScreen.tsx`
  - already capability-driven
  - likely minimal direct changes beyond labels or adapter-specific UX copy

The important point is that the UI should not special-case IronClaw business logic. It should receive:

- adapter identity
- capability claims
- normalized runtime events

### 7. Existing direct-runtime seam

- `src/app/api/runtime/custom/route.ts`
- `src/lib/runtime/custom/provider.ts`

These remain useful as fallback tools and reference material, but they are not the recommended primary path for IronClaw if the decision is a dedicated adapter.

Use them for:

- early experiments
- health and registry reference shapes
- future hybrid diagnostics

Do not make them the main IronClaw integration if a dedicated adapter is the chosen direction.

### 8. Documentation and scripts

Recommended additions once implementation begins:

- `docs/ironclaw-gateway.md`
- `package.json` script such as `ironclaw-adapter`
- optional compose or local-run docs for connecting the Claw3D container to the IronClaw adapter container

## Recommended IronClaw Capability Profile

Start conservatively.

Recommended V1 claims:

- `agents`
- `sessions`
- `chat`
- `agent-messages`
- `agent-handoffs`
- `streaming`
- `models`
- `agent-roles`

Optional later claims only when proven stable:

- `files`
- `skills`
- `approvals`
- `config`
- `cron`

Important rule:

Do not mark a capability as supported just because IronClaw can theoretically do it. Claim it only when the adapter exposes a stable Claw3D-facing behavior for that surface.

## Recommended Adapter Contract

The dedicated IronClaw adapter should expose the same broad gateway contract shape already used by Claw3D today:

- WebSocket connection
- `hello` response with adapter identity and metadata
- `req` / `res` / `event` frames
- stable session keys
- run identifiers for send/abort/wait flows

Minimum practical method set:

- `agents.list`
- `agents.create` or a deliberate `unsupported_method`
- `agents.update`
- `agents.delete`
- `sessions.list`
- `sessions.preview`
- `chat.send`
- `chat.abort`
- `run.wait`
- `models.list`
- `skills.status` if real

Event shape should be normalized enough that the existing runtime event layer can keep working:

- session activity updates
- streaming deltas
- final assistant turn
- error turn
- run lifecycle start/end/error

If the adapter produces OpenClaw-flavored gateway frames, the current `normalizeGatewayEvent()` path may be reusable at first.

## Container-Aware Architecture

Because OpenClaw, Hermes, and IronClaw are already running in separate containers, the cleanest deployment shape is:

```text
Browser
  -> Claw3D container
       -> ws://openclaw-gateway:18789
       -> ws://hermes-adapter:18789
       -> ws://ironclaw-adapter:18789
```

If Hermes or IronClaw are HTTP-native internally, the adapter container can sit beside them:

```text
Claw3D container
  -> Hermes adapter container -> Hermes runtime container
  -> IronClaw adapter container -> IronClaw runtime container
```

Recommended rule:

- Claw3D should know container endpoints and adapter identity
- Claw3D should not know provider-internal worker topology
- session routing, role selection, and internal orchestration stay inside the runtime or adapter layer

## Universal Runtime Architecture For OpenClaw, Hermes, And IronClaw

The long-term architecture should build on the existing runtime provider seam already present in:

- `src/lib/runtime/types.ts`
- `src/lib/runtime/createRuntimeProvider.ts`
- `src/lib/runtime/useRuntimeConnection.ts`

Target shape:

```text
Browser UI
  -> Studio runtime service
       -> OpenClawRuntimeProvider
       -> HermesRuntimeProvider
       -> IronClawRuntimeProvider
```

Responsibilities by layer:

### Browser UI

- render one connection model
- consume one capability model
- consume one runtime event model

### Studio runtime service

- own selected adapter identity
- connect to the correct runtime container
- normalize provider events
- expose one same-origin boundary to the browser

### Provider adapters

- translate provider-native API and event shapes
- declare honest capabilities
- preserve provider-specific metadata without leaking provider-specific control flow into the UI

## Implementation Order

### PR 1: Dedicated IronClaw adapter path

Scope:

- add `ironclaw` adapter type and profile support
- add `IronClawRuntimeProvider`
- add `server/ironclaw-gateway-adapter.js`
- add connection screen option and basic docs

Goal:

- IronClaw becomes a first-class selectable runtime without changing the overall Claw3D control plane

### PR 2: Runtime normalization cleanup

Scope:

- move more adapter-specific logic out of `GatewayClient`
- make runtime capability and runtime event handling more provider-centric
- reduce remaining OpenClaw-flavored assumptions where practical

Goal:

- OpenClaw, Hermes, and IronClaw all look like peers to the browser

### PR 3: Studio runtime router

Scope:

- optional server-side runtime registry or routing layer inside Studio
- centralize provider instantiation and health/status management
- prepare for richer multi-provider diagnostics

Goal:

- browser talks to one stable runtime service, even as provider logic grows more complex

## Recommendation Summary

Given the current repo and the fact that all three runtimes already live in their own containers:

1. Add a dedicated IronClaw adapter now.
2. Keep OpenClaw and Hermes on their existing containerized boundaries.
3. Do not force IronClaw through the generic `custom` provider as the primary path.
4. Use the existing runtime provider seam as the migration path toward a universal Studio runtime architecture.

That gives you the shortest credible implementation path now without giving up the cleaner backend-neutral shape later.