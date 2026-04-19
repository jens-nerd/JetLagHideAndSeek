# Automated Testing Concept — Design

> Strategy document for the JetLag Hide & Seek multiplayer app. Defines test goals, layers, tooling, CI, and rollout order. This is a living contract for future changes — anyone adding a test should be able to follow it without reinventing patterns.

## 1. Goals, scope, non-goals

### Goals

1. **Regression safety.** Every WS/REST contract, every session-state rule, and the core hider+seeker flow must have at least one test that breaks when regressed.
2. **PR gate.** Fast, deterministic run (< 2 minutes wall clock) on every PR and every push to `master`. Merges blocked on red.
3. **Living documentation.** A single `TESTING.md` plus this concept describe *how* to test, so contributors — human or AI — don't reinvent patterns.

### In scope

- **Backend** — REST + WebSocket, driven against an in-memory SQLite.
- **Shared package** — type-level checks + pure event helpers.
- **Frontend** — pure logic (maps, questions, operators) plus React components via `@testing-library/react` + happy-dom.
- **End-to-end** — multi-client Playwright suite running a full hider + seeker session against a real backend and the production frontend build.

### Out of scope / non-goals

- **Mobile app** (React Native/Expo) — separate concept later. Detox/Maestro setup is its own story.
- **Visual regression testing.** No screenshot diffing; UI polish stays manual.
- **Load / performance tests.** Irrelevant at current scale (single-instance WebSocket manager).
- **Line-coverage targets.** We aim for *contract coverage*, not arbitrary percentages.

## 2. Test pyramid

Five layers, from most units + fastest to fewest + slowest:

```
                ┌─────────────────────────────┐
        L5      │  E2E  — Playwright          │   few, slow, highest realism
                │  real backend + prod build  │
                ├─────────────────────────────┤
        L4      │  Components — RTL + vitest  │   dozens, medium
                │  happy-dom, nanostores real │
                ├─────────────────────────────┤
        L3      │  Backend WS integration     │   dozens, fast
                │  vitest + `ws` client       │
                ├─────────────────────────────┤
        L2      │  Backend REST integration   │   many, fast    (exists)
                │  vitest + Hono in-process   │
                ├─────────────────────────────┤
        L1      │  Unit — shared/pure logic   │   hundreds, very fast  (exists)
                │  vitest, no I/O             │
                └─────────────────────────────┘
```

### L1 — Unit (exists, expand)

Pure functions in `shared/src/*`, `src/maps/*`, `src/lib/*`. No DOM, no network. Today: map geometry, station manipulations, operators, importers, compress. Gaps to fill: event envelope helpers, `card-costs`, `photo-challenges`, `timer-context` math, `hiding-zone-loader`.

### L2 — Backend REST (exists, formalize)

`backend/src/test/helpers.ts` already spins up the real Hono app on in-memory SQLite (no external server required). Today: a single 415-line `api.test.ts`.

Plan: split by route module into `backend/src/test/rest/sessions.test.ts`, `questions.test.ts`, `overpass.test.ts`, `uploads.test.ts`; share fixtures via an expanded `helpers.ts`.

### L3 — Backend WebSocket (new)

Reuse the in-memory-SQLite harness; attach the real `ws.Server` so the app speaks actual WebSocket. A `makeWsClient(token)` helper opens a `ws://localhost:<random>` connection, buffers incoming messages, and exposes `send(event)` and `waitFor(type, matcher, { timeout })`.

Tests read like integration tests with two clients per session (hider + seeker). This is where the reviewer-flagged hiding-zone gaps live.

### L4 — Frontend components (new)

`@testing-library/react` + happy-dom. Mount a component with a fresh nanostores atom graph and a fake `WebSocket` that the test controls (messages in, messages out). Good fits: `MyZonePanel` (type select → `sendSetZone`), bottom-sheet tab gating, `SessionQuestionPanel` edge cases, `CreateSessionOverlay` form validation.

Leaflet-bound components (the Map itself) are **not** tested here — they're L5 territory. Stub them.

### L5 — End-to-end (new)

Playwright with two browser contexts = two players. Runner boots:

- `pnpm backend:dev` on a random port against a scratch SQLite file
- `pnpm preview` serving the built frontend configured against that backend

One test per user-visible flow: create session → hider picks zone → seeker joins → question asked → answered → zone revealed → endgame. Overpass and HERE are intercepted via Playwright's `route` handler and served canned JSON fixtures.

### Flakiness policy

- **L1–L4** — deterministic; zero flake tolerance. A flake is a bug. Fix or delete.
- **L5** — up to 1 retry in CI, 0 retries locally. Two consecutive red nights = treat as broken and triage.

## 3. External dependencies

Hybrid approach: PR-gate tests mock everything for speed and determinism; a scheduled nightly "contract" run hits real upstream APIs to catch drift.

| Dependency | PR-gate tests | Nightly contract tests |
|---|---|---|
| Overpass API | `msw` handler serves canned JSON fixtures per query | Hit `overpass-api.de` with the two queries the app actually uses; assert schema + non-empty result |
| HERE Browse API | `msw` handler, one fixture per place type | Real call with a throwaway key; assert schema + confirm the Overpass fallback still triggers on 429 |
| OSM tiles | never hit (Leaflet stubbed in L4, route-intercepted in L5) | n/a |
| Push notifications | `sendPush` replaced with a spy | n/a |
| SQLite | in-memory, migrated fresh per test | n/a |
| Photo uploads | tmp dir, cleaned by `afterEach` | n/a |

Fixtures live in `backend/src/test/fixtures/` and `tests/fixtures/`; one file per endpoint + scenario. A regeneration script `pnpm test:fixtures:refresh` hits real APIs and overwrites fixtures; run manually when an upstream schema changes.

## 4. Test data

- **DB per test**, not per file. `helpers.ts` already supports this; formalize with a `withTestApp(async ({ db, req, makeWs }) => …)` wrapper so every test gets an isolated SQLite.
- **Seed helpers** for common shapes: `makeSession({ …opts })` returns `{ session, hider, seeker, tokens }` and consolidates today's inline setup code.
- **Deterministic codes.** Session codes are generated randomly by the backend; tests accept the returned code rather than hardcoding it.
- **Time.** `vi.useFakeTimers()` for anything involving question deadlines or expiry. Add a `resetForTests()` helper on timer-context atoms if not already present.
- **Migrations.** `MIGRATE_SQL` in `helpers.ts` is today a hand-written copy of the real schema — it will drift. Fix by running the real migration runner (`backend/src/db/migrate.ts`) against in-memory SQLite. Lands alongside the L3 harness (step 1 in §6).

## 5. CI and runners

Split between GitHub Actions (fast PR gate) and a VPS cron (expensive nightly).

| Runner | What it runs | Budget |
|---|---|---|
| GitHub Actions — PR + push to `master` | L1 + L2 + L3 + L4 with all mocks | < 2 min wall clock |
| VPS systemd timer — nightly 03:00 local | L5 Playwright + real-API contract tests | any; auto-files issues on red |

**GitHub Actions pipeline:**

1. Checkout.
2. Cache `pnpm-store`.
3. `pnpm install --frozen-lockfile`.
4. `pnpm shared:build` (required by both packages).
5. Run the frontend and backend `vitest run` in parallel jobs.
6. Required status check on `master`.

**VPS nightly:**

1. `systemd` timer unit `hideandseek-nightly.timer` triggers `hideandseek-nightly.service`.
2. Service clones/updates a dedicated workdir (`/opt/hideandseek-tests`), separate from the live deploy at `/opt/hideandseek`.
3. Runs the Playwright suite + the contract tests.
4. Posts a summary to a Discord/Slack webhook (TBD — pick when step 9 lands).
5. On red, calls `gh issue create` to file a tagged issue. No pager, no email.

## 6. Rollout priority

Ordered. Each step is one-to-few days of work; later steps depend only on earlier ones.

1. **L3 harness + hiding-zone tests.** `makeWsClient(token)` + `withTestApp()`. First three tests close the reviewer's hiding-zone gaps: (a) pre-reveal seeker `sync` returns `hidingZone: null`, (b) seeker `set_hiding_zone` is ignored, (c) late-joining seeker after reveal receives the zone in `sync`. Also replaces the hand-written `MIGRATE_SQL` with the real migration runner. **Blocks nothing, unblocks everything below.**
2. **CI skeleton.** `.github/workflows/test.yml` — install, build shared, run `pnpm test:all`. Required check on `master`. No e2e yet. Gets the PR gate live with existing + new tests.
3. **L2 formalization.** Split `api.test.ts` into `sessions / questions / overpass / uploads`; move shared seeding into `helpers.ts`. Pure refactor; no new coverage.
4. **L3 expansion.** Remaining WS flows: question create/answer, GPS position broadcasting, participant join/leave, timer events, push-token registration.
5. **msw for Overpass / HERE.** Capture real calls once, commit fixtures, wire msw into `helpers.ts`. Retrofits L2 Overpass tests from "skip in CI" to deterministic.
6. **L4 setup + high-value components.** happy-dom + RTL wiring, then `MyZonePanel`, bottom-sheet tab gating, `SessionQuestionPanel`, `CreateSessionOverlay`. One component per PR.
7. **L1 gap-fill.** Pure modules listed in §2 (L1).
8. **L5 Playwright bootstrap.** Single golden-path spec: create → join → ask → answer → reveal → endgame. Multi-context. Route-intercept Overpass. Runs locally green before wiring into nightly.
9. **VPS nightly runner.** systemd timer + service, Discord/Slack webhook, `gh issue create` on red.
10. **L5 expansion.** One spec per user-visible flow: photo question, thermometer GPS, seeker-caught endgame, zone-change-while-revealed, late-join-after-reveal. Parallelized.

**Why this order:** L3 plus the hiding-zone tests come first because they're the highest-value gap *and* establish the harness the rest of L3 needs. CI is second because untested tests have no value. L4 / L5 are deliberately last — they're the most expensive to build and the least broken right now.

## 7. Conventions

### File layout

```
backend/src/test/
  helpers.ts              # withTestApp, makeWsClient, seed helpers (expanded)
  fixtures/               # canned Overpass / HERE JSON
  rest/                   # one file per route module
  ws/                     # one file per WS event family
tests/                    # frontend vitest (existing)
  components/             # new — RTL + happy-dom
  fixtures/
e2e/                      # new — Playwright
  playwright.config.ts
  flows/                  # one spec per golden path
  intercepts/             # shared Overpass / HERE route handlers
```

### Naming

- Describe behaviour, not code: `"seeker cannot set hiding zone"` — not `"test set_hiding_zone role check"`.
- `it.each` for parametric cases (e.g. the 5 station types in MyZonePanel).
- No `describe` nesting deeper than two levels.

### Layer discipline

- **L1** never imports from `backend/` and never mounts React.
- **L2** never opens a WebSocket.
- **L3** never makes HTTP calls that aren't part of the WS handshake.
- **L4** never talks to a real backend.
- **L5** never imports app internals — it drives the real browser only.

## 8. Open questions

To be resolved as the corresponding rollout step lands, not now.

1. **Persistent atoms under happy-dom.** `persistentAtom` uses `localStorage`; happy-dom provides it, but tests may need a per-test storage reset. Spike during L4 setup (step 6).
2. **Playwright on the VPS.** Chromium-only is sufficient. Decide at step 9 between `npx playwright install --with-deps chromium` on the host versus shipping a container.
3. **Nightly alert channel.** Discord vs. Slack vs. email vs. GitHub issues only. Pick at step 9.

## 9. Success criteria for the concept itself

- Every reviewer-flagged issue in the most recent hiding-zone code review would have been caught by a test under this concept.
- A new contributor can add a test in any layer in under 30 minutes, using only `TESTING.md` and a nearby example.
- CI PR-gate stays under 2 minutes wall clock through step 7.
- Nightly e2e + contract suite stays under 15 minutes wall clock through step 10.
