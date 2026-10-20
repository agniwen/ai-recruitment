# Regression Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the regression failures documented for PR #3 and verify the integrated branch against current main.

**Architecture:** Keep production authorization and workflow rules intact. Repair stale fixtures and source-inspection boundaries where evidence shows the implementation moved; fix production behavior only where a behavioral regression proves it wrong.

**Tech Stack:** TypeScript, Vitest, Hono, React, PostgreSQL.

**Spec:** `docs/releases/2026-10-20-ssc-telegram-validation.md` and the user's instruction to continue until tests pass.

## Global Constraints

- Use a separate test database with schema only, fake external-service configuration, and no real bot credentials.
- Do not skip failing tests or remove meaningful security assertions.
- Keep fixes on the existing PR branch; do not merge the PR.

## Review Focus

- Workspace selection must stay explicit even when an authentication session remembers another organization.
- Anonymous requests must remain blocked when authenticated route fixtures are repaired.
- Uploaded screenshot confirmation must remain a separate, human-confirmed transition.
- Source-inspection checks must tolerate CRLF and route extraction while detecting the same violations.
- Navigation and SSR checks must finish on observable state, without arbitrary timing assumptions.

### Task 1: Backend behavioral fixtures

**Files:** Failing backend test files for ODC visibility, credential verification, platform cache, external interviewer bindings, job codes, mail ingest, pool deletion/binding, batch recovery, resume DTOs, interview PATCH, and round emails.

**Interfaces:** Use current route/DAO contracts and the isolated QA database; no changes to unrelated permissions.

- [x] Reproduce the failing tests on the integrated branch and inspect each first failure.
- [x] Repair missing columns, mock exports, authenticated/MFA state, and workflow-complete fixtures only after checking the corresponding production contract.
- [x] Verify the affected files, including negative authorization cases.

### Task 2: Frontend regressions

**Files:** Failing Web architecture, migration, scheduling, navigation, and resume-pool SSR tests and directly related implementation files.

**Interfaces:** Existing page/component APIs and public route behavior; no backend edits.

- [x] Reproduce the nine remaining selected-file failures and the full-run navigation/SSR failures.
- [x] Fix stale source boundaries, line-ending assumptions, missing mocks, and asynchronous state waits with targeted evidence.
- [x] Run the affected tests, then the complete Web suite.

### Task 3: Backend source boundaries and integration

**Files:** Internal error response boundary test, workspace authorization test and role policy, hiring-unit/interview/resume source-inspection tests, release validation notes.

**Interfaces:** Explicit organization ID for role classification; all business routes retain authentication and workspace guards.

- [x] Verify false positives and moved route/DAO implementations before updating source checks.
- [x] Add regression examples for safe 400 responses versus unsafe 500 responses, and retain explicit-workspace checks.
- [x] Run affected tests, all six JS package suites, backend/Web typechecks, and changed-file lint.
- [x] Review the final diff, update validation/release notes, push to PR #3, and verify the remote head.
