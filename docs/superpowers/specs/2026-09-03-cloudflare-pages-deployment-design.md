# Cloudflare Pages Deployment Design

Date: 2026-09-03

Status: Approved for implementation.

Branch: `codex/cloudflare-deployment`, based on `b579d17`.

## Goal

Deploy AgentDAW as a static Next.js site on Cloudflare Pages and reject changes that fail the existing project checks before they merge.

## Architecture

Next.js produces a static export in `out/`. Cloudflare Pages connects directly to the GitHub repository, builds pull requests as preview deployments, and deploys `main` to production. GitHub Actions provides CI only; Cloudflare's native Git integration provides CD.

This matches the application's browser-only architecture. Web Audio and IndexedDB continue to run locally in each visitor's browser, and no Worker, server runtime, database, Cloudflare API token, or Wrangler dependency is introduced.

## Repository Changes

- Set `output: "export"` in `next.config.ts`.
- Add `.github/workflows/ci.yml` for pull requests and pushes to `main`.
- Update `README.md` with the Cloudflare Pages build settings and the one-time dashboard setup.
- Add no runtime or development dependencies.

## CI Contract

GitHub Actions uses Node.js 24 and pnpm 10.17.0. It installs from `pnpm-lock.yaml` with `--frozen-lockfile`, then runs these existing commands:

1. `pnpm test`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm build`

A failed command fails the workflow. Dependency caching may use the cache built into `actions/setup-node`; no custom cache scripts or deployment credentials are needed.

## Cloudflare Pages Contract

The Pages project uses:

- Repository: `amit-00/agent-daw`
- Production branch: `main`
- Build command: `pnpm build`
- Build output directory: `out`
- Node.js version: 24
- pnpm version: 10.17.0, as declared by `packageManager`

Cloudflare creates preview deployments for non-production branches and production deployments for `main`. The repository does not duplicate that deployment logic in GitHub Actions.

## Failure Behavior

- CI blocks a merge when tests, type checking, linting, or the static export fails.
- Cloudflare reports build or deployment failures in the Pages deployment history.
- A Cloudflare outage does not require changes to the repository; retry the failed deployment from Cloudflare.
- Project data remains browser-local. Deployments do not migrate, upload, or synchronize IndexedDB data.

## Verification

The user authorized skipping new tests for these configuration-only changes. Verification consists of the existing complete test suite, type checking, linting, a production build, and confirming that `out/index.html` exists after the build.

## User Action

After this branch reaches GitHub, the repository owner must authorize Cloudflare's GitHub integration and create the Pages project using the settings above. No Cloudflare API token or GitHub deployment secret is required.

## Non-goals

Workers, vinext, OpenNext, server-side rendering, custom domains, Cloudflare Access, analytics, backend storage, and environment-specific application configuration are excluded. Add them only when the application gains a concrete server-side or operational requirement.
