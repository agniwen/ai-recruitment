# SSC completion confirmation and screenshot plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Implement the approved web and TG interaction, test first, and deploy the verified result.

**Goal:** Explicit internal-approval confirmation before SSC completion in web and Telegram, with an optional independent approval screenshot. Remove the old ODC attachment feature.

**Architecture:** Reuse the current Offer authorization, revision checks, transaction/audit/outbox and private S3 storage. Persist a separate nullable SSC completion attachment; never reuse the old ODC attachment. Telegram uses PostgreSQL-backed per-prompt pending state and a final explicit action, with screenshots correlated to a specific upload reply.

**Tech stack:** React, TanStack Query, Hono, Drizzle/Postgres, Chat SDK Telegram, S3, Vitest.

**Spec:** User approved the preceding web/TG templates and then instructed removal of the original ODC review attachment.

## Constraints

- Opening the dialog, uploading a screenshot, canceling or expiring must never complete an Offer.
- No image is required. One JPEG/PNG/WebP image up to 10 MB, with server media/signature validation.
- Final submission requires `internalApprovalConfirmed: true` and current SSC revision.
- Keep actual role, current source and candidate visibility checks for both channels.
- Screenshot metadata is separate from old ODC material; private storage keys never appear in DTO/audit.
- Preserve historical stored ODC files and data; remove UI entrypoints and reject legacy attachment writes.
- TG requires bound private actor, nonce + prompt + Offer + revision correlation, expiry and bounded file download.
- Old or replayed buttons and simultaneous completions cannot overwrite evidence or duplicate audit/notifications.

## Tasks and ownership

1. Backend (`font_latency_check`): schema + SQL migration, DTO, completion DAO/service, child SSC routes, image validation, private evidence reading and old ODC attachment write deprecation. Service: `completeOfferSscWithScreenshot({actor,draftId,interviewRecordId,organizationId,revision,internalApprovalConfirmed:true,file?,source?}) -> OfferDraftRecord`.
2. Web (`offer_ssc_ui`): complete-confirmation dialog, optional image upload/paste/preview/removal, errors/draft resets, completion evidence display, remove old ODC attachment UI. API sends JSON without image and multipart with image.
3. TG (`ssc_source_review`): first `osc` only opens a confirmation card; final `osf` explicitly completes, `osu` requests a screenshot reply, `osx` cancels. Durable state isolates multiple Offers and verifies live permissions/revision on each stage.
4. Integration/release (root): failing tests, isolated DB migration, green tests/static checks, independent review, data/config backup, isolated production build, migrate/switch all local entrypoints, API + browser proof and data integrity.
5. Recipient routing (root): pending cards only reach source-assigned SSC members, using canonical ledger email and verified private TG start. Refuse ambiguous emails, shared handles and conflicting personal profiles. Pin the first verified numeric TG identity in a separate table; usernames cannot silently transfer approval identity.

## Verification ledger

- Baseline `796859c5021a3078f935d6e925c146da448f8722`, feature worktree clean.
- Approved interaction: explicit positive final button; optional image; cancel unchanged.
- Added scope: remove ODC attachment create/edit/display, retain historical files without exposing new write paths.
- Isolated behavioral RED observed: backend/TG 22 failures, web 28 failures; source-ledger routing 4 failures. Additional identity migration, concurrent screenshot and oversized body regressions failed before their fixes.
- Independent backend and TG reviews identified global identity conflicts, username transfer and screenshot/final-click races; all received focused fixes and regressions.
- Fresh database/config backup verified at `/home/sheldon/ATS/backups/ssc-20261018-020313` (198 candidates, 16 Offers). Historical ODC attachment business data is included in the before/after integrity check.
- Final isolated verification: 399 backend tests across 21 files, 59 web tests across 3 files; all passed. Focused reruns after lint fixes also passed. All 7 package typechecks passed; lint on 35 changed TS/TSX files reported zero warnings/errors.
- Live Telegram delivery remains deferred until the user configures the bot token and SSC private `/start` bindings; no real bot message was sent during development.
