# SSC responsibility role and Offer data scope implementation plan

> **For agentic workers:** Execute the following independent ownership groups in the existing feature worktree. The user has authorized implementation and confirmed the visibility trigger and unmatched-source handling.

**Goal:** Connect SSC pre-entry records to actual workspace SSC roles and department/center sources, with candidate access starting at pending Offer receipt.

**Architecture:** Explicit SSC role metadata and scoped foreign keys support an independent candidate access predicate. Existing contacts remain pre-entry data until a unique email can bind a real workspace user. Administrator writes and initial backfill synchronize membership; repeated login preserves manual role changes.

**Spec:** `docs/superpowers/specs/2026-10-17-ssc-role-source-visibility-design.md`.

## Tasks

- [ ] Root: database schema/migration, role metadata/API/editor, membership provisioning, test database readiness, coordinated verification and deployment.
- [ ] Backend data worker: SSC schema/DAO/routes/options, scoped validation, write serialization, stable identity uniqueness, and integration tests.
- [ ] Access worker: SSC principal and latest-Offer predicate, central candidate scope, review/Offer bypass protection, unsafe independent surface restrictions, and authorization tests.
- [ ] UI worker: role/source selectors and labels, existing unresolved record preservation, grid live names, and editor tests.

## Verification and rollout

- [ ] Confirm RED tests fail on old behavior, then run focused GREEN suites against an isolated database.
- [ ] Test cross-workspace and wrong-role references, optional contacts, source renames/rebinding, duplicate identities, and concurrent conflicting email/role intents.
- [ ] Test no Offer → pending receipt → confirming → completed; deletion/cancellation of the latest Offer; old null SSC Offers; no sources/email/rows; broad recruiting/ODC/AI permissions; review/attachment/direct API and TG consistency.
- [ ] Test automatic first membership creation, administrator save synchronization, ambiguous/banned/owner/admin/noAccess preservation, and later login not overriding manual role changes.
- [ ] Run root typecheck, targeted lint, relevant regression suites, independent review, and full production build.
- [ ] Back up current data/config; migrate once, backfill only requested workspace, precisely verify 69 rows/28 links/41 pending, preserve all unrelated business records and action permissions.
- [ ] Deploy private-IP production service, verify authenticated page/selector behavior, save screenshot proof and deployment notes, preserve rollback and HTTPS fallback.

## Verified implementation

2026-10-17: isolated database migrations succeeded; 340 backend tests and 32 web tests passed with no skipped cases in the final focused suites. All seven package typechecks and targeted lint passed. Independent review found and verified repairs for revoked-intention provisioning, mixed SSC role bypass, and source-deletion uniqueness conflicts. Deployment and the precise 69-row backfill follow these checks.

Final hardening also covers single SSC roles with surrounding spaces or tabs/newlines, which Better Auth preserves in invitations. Both new cases failed before the repair; all 108 affected access/route tests, targeted lint, and the backend typecheck passed afterward.
