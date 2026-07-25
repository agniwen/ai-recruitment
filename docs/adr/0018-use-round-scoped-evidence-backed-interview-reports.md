---
status: accepted
---

# Use round-scoped evidence-backed interview reports

An **Interview Report** belongs to one AI interview round rather than to a candidate-level aggregate. A candidate may have multiple reports, and every report uses a shared, versioned contract that combines three source families: the frozen resume, submitted candidate forms, and candidate statements from that round. Each substantive conclusion must cite typed source evidence; generated conclusions are not evidence, source conflicts remain explicit, and missing required sources block submission.

## Decision

- `@arc/shared` owns the strict Zod contract and inferred API types. `schemaVersion` identifies the contract shape; `reportVersion` identifies an immutable generation within one round. Raw JSONB is parsed at the DAO boundary and is never exposed to application consumers as `Record<string, unknown>`.
- A report may be regenerated while it is a draft. An authenticated workspace member explicitly submits one version; submission atomically freezes that version and moves the report through `draft -> submitted -> decided`. A submitted report cannot return to draft or be regenerated.
- Submitting a report freezes its AI interview round. The system rejects later round field updates, status changes, resets, single deletes, and bulk deletes that would detach the report from its evidence.
- An authenticated member with recruiting visibility and `interview.update` permission makes the binary **Business Interview Entry Gate** decision in the system: advance to `human_interview`, or close as `rejected`. Advancing additionally requires `humanInterview.create`. Only the submitted report for the candidate's terminal AI interview round is decision-eligible: that round is `completed`, has the greatest remaining `sortOrder`, and every remaining AI interview round is `completed`. The report decision and candidate-stage transition are recorded atomically with audit history.
- The fork's job-level `aiInterviewDisabled` guard remains authoritative for entering the AI interview stage and launching a new AI interview round. It does not make an already completed round's report unreadable or bypass the permissions required for a report decision.
- Advancing the business interview entry gate changes the candidate stage but does not create or schedule a human interview round. Human interview scheduling remains a separate, editable action; job-configured default human interviewers continue to seed that dialog without becoming mandatory assignments.
- Every immutable report version carries `contentKind`: `v1` for the strict evidence-backed contract and `legacy` for the typed legacy adapter. A round with exactly one verifiable historical evaluation may be migrated as an immutable legacy version. A round with multiple competing historical evaluations enters `migration_conflict` until an audited human mapping selects the authoritative version.
- Candidate hard deletion is rejected while any round-owned report is `submitted`, `decided`, or in `migration_conflict`. Draft-only reports may be deleted explicitly in the same transaction before deleting the candidate. Database foreign keys restrict bypass deletion.

## Consequences

The current conversation-scoped evaluation becomes an input to a round-owned draft rather than the public report contract. Report generation, API responses, and UI rendering share one typed model, and the system records report submission separately from the later candidate-stage decision.

Historical conversation evaluations remain readable through a typed legacy adapter or backfill, but they do not silently acquire provenance that was never captured. A legacy evaluation may be regenerated as V1 only when its original evidence snapshot is verifiably bound to the same conversation, round, and context snapshot. Snapshots reconstructed from a later active context, current form submissions, or a guessed schedule entry are insufficient; those evaluations remain typed legacy read-only records.

All report submission, round mutation, candidate deletion, and final-decision paths use one database lock order: candidate first, then its rounds in stable order, then the round-owned report. Guards are re-evaluated inside that transaction after locks are acquired.

## Considered options (rejected)

- One candidate-level report aggregating multiple AI rounds: rejected because evidence and decisions must remain attributable to a specific round.
- Keeping conversation evaluations as the API contract: rejected because retries and round resets can produce multiple conversations while the recruiting workflow needs one authoritative report per round.
- Mutating a submitted report when a newer generation is available: rejected because it would rewrite reviewed evidence and conclusions.
- Letting the AI recommendation transition the candidate automatically: rejected because the business interview entry gate is an attributable human decision governed by existing pipeline permissions.
