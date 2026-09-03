# Cloudflare Pages Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a Cloudflare Pages-compatible static build and add GitHub Actions CI for every pull request and push to `main`.

**Architecture:** Next.js exports the browser-only application to `out/`; Cloudflare Pages' native Git integration owns preview and production deployments. One GitHub Actions job installs the pinned toolchain and runs the repository's existing verification commands without deployment credentials.

**Tech Stack:** Next.js 16, Node.js 24, pnpm 10.17.0, GitHub Actions, Cloudflare Pages

**Spec:** `docs/superpowers/specs/2026-09-03-cloudflare-pages-deployment-design.md`

## Global Constraints

- Add no runtime or development dependencies.
- Keep deployment credentials out of GitHub because Cloudflare Pages' Git integration owns CD.
- Preserve browser-local Web Audio and IndexedDB behavior.
- The user authorized skipping new tests for these configuration-only changes; verify with the existing suite and a real static build.

---

### Task 1: Static export and CI

**Files:**
- Modify: `next.config.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the existing `test`, `typecheck`, `lint`, and `build` package scripts and `pnpm-lock.yaml`.
- Produces: a static site in `out/` and a GitHub status check named `CI / verify`.

- [ ] **Step 1: Enable static export**

Update `next.config.ts` to preserve `agentRules: false` and add:

```ts
output: "export",
```

- [ ] **Step 2: Create the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6
      - name: Set up pnpm
        uses: pnpm/action-setup@v6
      - name: Set up Node.js
        uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Test
        run: pnpm test
      - name: Typecheck
        run: pnpm typecheck
      - name: Lint
        run: pnpm lint
      - name: Build
        run: pnpm build
```

The pnpm action reads `pnpm@10.17.0` from `package.json`; no duplicated version input is needed.

- [ ] **Step 3: Verify the static build**

Run:

```bash
pnpm build
test -f out/index.html
```

Expected: both commands exit 0 and Next.js reports static output.

- [ ] **Step 4: Commit**

```bash
git add next.config.ts .github/workflows/ci.yml
git commit -m "ci: add static build verification"
```

---

### Task 2: Cloudflare setup documentation and final verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the `out/` build contract from Task 1.
- Produces: exact one-time Cloudflare Pages dashboard settings for the repository owner.

- [ ] **Step 1: Document deployment**

Add a `## Deployment` section after Development containing:

```markdown
## Deployment

Cloudflare Pages deploys this static application through its GitHub integration. Create a Pages project for `amit-00/agent-daw` with:

- Production branch: `main`
- Build command: `pnpm build`
- Build output directory: `out`
- Environment variable: `NODE_VERSION=24`
- Environment variable: `PNPM_VERSION=10.17.0`

Cloudflare creates preview deployments for other branches and production deployments for `main`. GitHub Actions runs tests, type checking, linting, and a production build before merge; no Cloudflare API token is stored in GitHub.
```

- [ ] **Step 2: Run full verification**

Run each command and require exit code 0:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
test -f out/index.html
git diff --check
```

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git status --short
git diff HEAD
```

Expected: only `README.md` remains uncommitted; earlier committed spec, plan, Next.js configuration, and CI workflow are present in branch history.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document Cloudflare Pages deployment"
```
