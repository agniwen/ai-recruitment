# Resume folder import local mode

## Goal

Extend `import-resume-folder` with `--mode remote|local`:

- **remote (default)**: unchanged — enqueue to `resume-parse`, online workers consume.
- **local**: still use online DB / Redis / object storage; enqueue to an isolated queue `resume-parse-local`; the import process embeds a BullMQ worker that runs `runBulkResumeUploadWorkflow` locally so CPU/orchestration stays on the laptop.

## Queue isolation

| Mode   | Queue name           | Consumer                                 |
| ------ | -------------------- | ---------------------------------------- |
| remote | `resume-parse`       | Online worker (unchanged)                |
| local  | `resume-parse-local` | Embedded worker inside the import script |

Same Redis instance and existing prefix (`arc:resume-parse:<db-hash>`). Only the BullMQ queue name differs, so online workers never see local jobs.

## Local mode flow

1. Scan / merge state / upload (same as today).
2. Start embedded worker on `resume-parse-local` early (overlaps with later enqueue).
3. Plan batches, insert batch rows in online DB, enqueue jobs to `resume-parse-local`.
4. On resume, also re-enqueue items still `pending` for already-`queued` batches.
5. Wait until the local queue is idle (no waiting/active/delayed/…).
6. Close worker + queues; summarize from local state + DB-backed item outcomes.

## Recording

- Online DB: batch + item status machine unchanged (`pending` → `processing` → `succeeded`/`failed`).
- Redis: job lifecycle on `resume-parse-local` only.
- Local JSONL: upload/batch checkpoints; configuration stores `importMode` so resume cannot mix modes with the same state file.

## CLI

```text
--mode remote|local          default remote
--parse-concurrency <n>     local only; embedded worker concurrency (default 4, max 32)
```

Other flags unchanged (`--root`, `--workspace`, `--commit`, upload `--concurrency`, etc.).

## Non-goals

- No second Redis.
- No change to online worker listeners.
- OCR/LLM still use configured cloud APIs; “local” means the worker process runs on the import machine.
