# Fork Maintenance

This repo already has the right remote layout for a fork-first workflow:

- `origin` points at your fork
- `upstream` points at `iamlukethedev/Claw3D`

The helpers below assume that model and keep day-to-day work on your fork's `main` branch.

## Fork GHCR rollout

The existing publish workflow in `.github/workflows/docker-publish.yml` already publishes owner-scoped images:

- pushing `main` publishes both `ghcr.io/<owner-lowercase>/claw3d:main` and `ghcr.io/<owner-lowercase>/claw3d:latest`
- pushing a `v*` tag publishes the version tag and refreshes `ghcr.io/<owner-lowercase>/claw3d:latest`

Recommended operator model:

- treat `:latest` as the normal user-facing image for your fork
- keep `:main` available as an explicit fallback or debugging tag
- use version tags when you want an immutable release marker

Recommended rollout:

1. Push your fork's `main` branch so GitHub Actions builds `ghcr.io/<your-owner-lowercase>/claw3d:latest`.
2. Run `npm run fork:image-env -- --write` to point local Docker Compose at that image and keep `HOST_BIND=127.0.0.1` plus `STUDIO_ACCESS_LOCAL_HELPER=1`.
3. Run `npm run fork:refresh-docker` to pull the configured image and recreate the running container.

If you only want to preview the `.env` changes first, run `npm run fork:image-env` without `--write`.
If you want to pin Docker to the branch tag instead, use `npm run fork:image-env -- --tag main --write`.

## Local automation commands

- `npm run fork:image-env`
  Prints the recommended `.env` values for the current fork owner. By default, it targets `:latest`.

- `npm run fork:image-env -- --write`
  Writes `CLAW3D_IMAGE`, `HOST_BIND`, and `STUDIO_ACCESS_LOCAL_HELPER` into `.env`.

- `npm run fork:image-env -- --tag main --write`
  Switches local Docker back to the branch tag if you want to pin to `:main` instead of `:latest`.

- `npm run fork:sync-upstream`
  Fetches `origin` and `upstream`, then reports how many commits are fork-only vs upstream-only on `main`.

- `npm run fork:sync-upstream -- --merge --push`
  Fetches, merges `upstream/main` into your current `main`, and pushes back to your fork. The script refuses to do this on a dirty worktree or from the wrong branch.

- `npm run fork:refresh-docker`
  Pulls the configured `claw3d` image, recreates the service, and shows `docker compose ps`.

- `npm run fork:refresh-docker -- --dry-run`
  Prints the Docker commands without running them.

## Suggested maintenance cadence

For a fork that periodically absorbs upstream changes and keeps a fork-owned image fresh:

1. Run `npm run fork:sync-upstream`.
2. If upstream has moved and your worktree is clean, run `npm run fork:sync-upstream -- --merge --push`.
3. Let your fork's `docker-publish` workflow publish a new `ghcr.io/<your-owner-lowercase>/claw3d:latest` image from `main`.
4. Run `npm run fork:refresh-docker`.

That keeps local Docker following your fork's latest reviewed `main` image while still taking upstream changes through an explicit merge step.

## Upstream-worthy split

The current working tree naturally splits into three buckets.

### 1. Upstream bugfix: production image startup

Stage only:

```powershell
git add Dockerfile
git commit -m "fix(docker): ship compiled next.config.js in runtime image"
```

Why it belongs upstream:

- It fixes the root cause in the published runtime image.
- It removes the need for the local `next.config.js` bind-mount workaround once a new image is published.

### 2. Upstream fix: lowercase GHCR owner in Docker publish workflow

Stage only:

```powershell
git add .github/workflows/docker-publish.yml
git commit -m "fix(ci): lowercase GHCR image owner"
```

Why it belongs upstream:

- Docker image references must be lowercase.
- Mixed-case GitHub owners can otherwise produce invalid GHCR image names on forks.

### 3. Upstream improvement: localhost studio access helper

Stage only:

```powershell
git add server/access-gate.js server/index.js tests/unit/accessGate.test.ts README.md SECURITY.md .env.example docs/studio-access-gate.md
git commit -m "feat(access): add localhost studio access helper"
```

Why it belongs upstream:

- It improves the local operator flow without weakening remote deployments.
- The helper remains localhost-oriented, and remote setups are still documented to use a proxy or auth layer.

### 4. Fork-only operational glue

Keep these out of the upstream PR unless you deliberately want to propose them separately:

- `docker-compose.yml`
- `next.config.js`
- `docs/fork-maintenance.md`
- `scripts/fork-image-env.mjs`
- `scripts/fork-sync-upstream.mjs`
- `scripts/fork-refresh-docker.mjs`
- `package.json` entries for the fork helper commands

These files are specific to your fork's deployment and maintenance workflow.

## PR draft: Docker image bugfix

```md
## Summary

Fix the production container image so Next.js no longer depends on a TypeScript runtime at startup.

## What changed

- compile `next.config.ts` to `next.config.js` during the build stage
- copy the compiled JavaScript config into the runtime image instead of the TypeScript source file

## Why

The published runtime image currently ships `next.config.ts` with production-only dependencies. At startup, Next.js attempts to resolve TypeScript support dynamically, which fails in this image path and can trigger a crash loop.

## Result

The runtime image starts with a plain JavaScript Next config and no longer depends on startup-time TypeScript installation.
```

## PR draft: localhost studio access helper

```md
## Summary

Add a minimal localhost-oriented `/studio-access` helper for local development and Docker runs.

## What changed

- add a helper page that sets the `studio_access` cookie after the configured token is entered
- add a clear-cookie path for token rotation during local testing
- keep remote deployments on proxy- or auth-layer cookie provisioning
- document the local helper boundary and add unit coverage for the flow

## Why

When `STUDIO_ACCESS_TOKEN` is enabled, the current repo has an access gate but no built-in local cookie bootstrap flow. That leaves local operators at a 401 until they manually mint the cookie outside the app.

## Result

Local Docker and localhost runs have a small in-app bootstrap path, while remote deployments continue to rely on a proper external auth or proxy boundary.
```

## Where to automate next

The scripts above are the first safe layer of automation because they keep control local and explicit. The next layer, if you want it later, is a fork-only GitHub Actions workflow that:

1. runs on a schedule,
2. fetches `upstream/main`,
3. opens a PR from a sync branch into your fork's `main`,
4. lets the existing `docker-publish.yml` workflow publish `ghcr.io/<your-owner-lowercase>/claw3d:latest` after that PR is merged.

That keeps upstream sync reviewable instead of silently mutating `main`, which is the safer model for a user-facing fork.