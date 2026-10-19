# Source SSC Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Manage SSC assignments from each department/center, while pre-entered Google users receive their configured SSC role and only see eligible offers from assigned sources.

**Architecture:** Keep `ssc_responsibility` as the single assignment ledger. Extend its existing administrator API with an exact source filter, eligible people lookup, and atomic batch assignment; reuse its existing editor and CRUD in the source modal. Preserve the existing login provisioning and candidate authorization boundary.

**Tech Stack:** Hono, Drizzle/Postgres, Better Auth, TanStack Query, React, Vitest.

**Spec:** The user's request in this conversation, including confirmed whole-source assignments and the earlier pending-SSC-offer visibility rule.

## Global Constraints

- Only actual workspace owner/admin with `page:sscResponsibilities` may manage these assignments.
- Roles must be actual SSC audit roles (`isSsc`, never ODC or built-in privileged roles).
- Preserve all existing pre-entry records, including contacts without registered accounts.
- Do not add sequence/service-unit SSC scope or a second assignment table.
- Unassigned, ambiguous, banned and `noAccess` identities must not gain candidate access.
- Google OAuth needs an already registered callback; tests must not pretend to complete external Google authentication.

## Review Focus

- Cross-workspace source IDs and forged candidate IDs fail without partial writes.
- Stale role/member eligibility is rechecked at write time, not trusted from the selector.
- Duplicate contacts and batch failures leave all assignments unchanged.
- Changing source or losing administrator permission hides stale data and resets drafts.
- First authenticated session applies pre-entry membership, without overwriting existing manual roles.

### Task 1: Source assignment API

**Files:** SSC responsibilities `schema.ts`, `route.ts`, `dao.ts`, focused assignment DAO and tests under the same backend subresource.

**Interfaces:** GET list accepts `resumeSourceId`; GET `/candidates?resumeSourceId=` returns eligible contact records with `id,sscName,email,telegram,workspaceRole,workspaceRoleName,registered,assigned`; POST `/assign` accepts `{resumeSourceId,candidateIds}` and returns successful count. Candidate IDs are opaque member/pre-entry references, server-resolved inside the transaction.

- [x] Write source filtering, eligibility, permission, duplicate and atomicity tests; run and observe failure on the missing behavior.
- [x] Implement source filter and transactional assignment without nested advisory-lock transactions.
- [x] Run focused backend tests and typecheck.

### Task 2: Source management UI

**Files:** source management page, source SSC modal/add dialog, shared SSC editor and their web tests.

- [x] Write behavioral tests for source action, administrator gate, fixed source, multi-select, existing assignment disabled and refresh; observe failure.
- [x] Add 管理 SSC alongside 管理 ODC, list existing pre-entries, select eligible SSC contacts or pre-enter a new one.
- [x] Reuse SSC ledger CRUD; invalidate SSC list and workspace-member query prefixes after mutations.
- [x] Run focused web tests and typecheck.

### Task 3: Login wiring and release

**Files:** auth integration test, this plan and release evidence outside the repository.

- [x] Verify the native session creation hook provisions the pre-entered identity and is idempotent.
- [x] Run SSC/access regression tests, static checks and independent code review.
- [ ] Build an isolated production release; back up current data/configuration before switching IP and HTTPS/worker sources.
- [ ] Verify live read-only APIs, actual management UI and unchanged existing business data.

## Execution ledger

- Baseline: `1c8f47b77a3c19617f9e02bf241b9f3e469c267b`, clean feature worktree.
- Confirmed: source scope covers the current department/center as a whole.
- Ruling: use existing SSC CRUD for editing/deleting from both entrypoints; deletion has the same explicit semantics everywhere, avoiding hidden split behavior.
- Preflight: API and UI share the documented candidate contract; distinct file ownership. Auth wiring test only consumes existing provisioning and does not alter login behavior.
- RED: backend 8 expected failures and UI 13 expected failures, with existing behavior passing.
- GREEN: 12 source assignment tests, 3 native auth tests, 66 existing SSC route tests; 32 web tests; existing 342-test SSC/access/Offer/TG regression passed.
- Independent read-only review found no actionable issues in API, UI or session wiring. Formatting/lint and typecheck precede release.
- Final code: 0 formatting/lint findings across 14 TypeScript files; all 7 packages typecheck; post-format 15 new backend and 32 web tests passed.
