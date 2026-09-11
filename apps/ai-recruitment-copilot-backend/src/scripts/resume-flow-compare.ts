/** Read-only candidate snapshot; real OCR -> structure -> review calls in both repos.
 * Both sides use the same web .env, resume bytes and associated job description.
 * Run with tsx and --resume-id <id> --reference-root /path/to/ai-interview.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import type * as CurrentPipeline from "../lib/server/resume-parse-pipeline";
import type * as CurrentParser from "../server/agents/resume-parser-agent";
import type * as CurrentReview from "../server/agents/resume-analysis-review";

const root = path.resolve(import.meta.dirname, "../../../..");
const { values } = parseArgs({
  options: {
    env: { default: path.join(root, "apps/ai-recruitment-copilot/.env"), type: "string" },
    output: {
      default: path.join(
        root,
        ".eval/resume-flow-compare",
        new Date().toISOString().replaceAll(/[:.]/g, "-"),
      ),
      type: "string",
    },
    "reference-root": { default: path.resolve(root, "../ai-interview"), type: "string" },
    "resume-id": { type: "string" },
    side: { type: "string" },
  },
});
const output = path.resolve(values.output);
const envPath = path.resolve(values.env);
const loaded = loadEnv({ override: true, path: envPath, quiet: true });
if (loaded.error) {
  throw new Error(`Cannot load env file: ${envPath}`);
}

interface InputSnapshot {
  candidateName: string;
  fileName: string;
  jobDescription: string;
  jobDescriptionId: string;
  resumeId: string;
  sha256: string;
}
interface RequestMetric {
  stage: string;
  model: string;
  endpoint: string;
  thinkingDisabled: boolean;
  durationMs?: number;
  status?: number;
  usage?: unknown;
}
async function save(name: string, data: unknown) {
  await writeFile(path.join(output, name), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}
async function prepare() {
  if (!values["resume-id"] || !process.env.DATABASE_URL) {
    throw new Error("--resume-id and DATABASE_URL are required.");
  }
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    await sql`SET default_transaction_read_only = on`;
    const [row] = await sql`SELECT s.id, s.candidate_name, s.resume_file_name, s.resume_storage_key,
      s.job_description_id, j.name AS jd_name, j.description AS jd_description, j.prompt AS jd_prompt
      FROM studio_interview s LEFT JOIN job_description j ON j.id = s.job_description_id
      AND j.organization_id = s.organization_id WHERE s.id = ${values["resume-id"]}`;
    if (!row?.resume_storage_key || !row.jd_name) {
      throw new Error("Resume file or associated job is missing.");
    }
    const { getObjectBytes } = await import("../lib/server/s3");
    const document = await getObjectBytes(row.resume_storage_key);
    if (!document) {
      throw new Error("Resume object not found.");
    }
    await writeFile(path.join(output, "resume.pdf"), document.bytes, { mode: 0o600 });
    const snapshot: InputSnapshot = {
      candidateName: row.candidate_name,
      fileName: row.resume_file_name,
      jobDescription: [
        `岗位名称：${row.jd_name}`,
        row.jd_description ? `岗位描述：${row.jd_description}` : null,
        `岗位 Prompt：\n${row.jd_prompt}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      jobDescriptionId: row.job_description_id,
      resumeId: row.id,
      sha256: createHash("sha256").update(document.bytes).digest("hex"),
    };
    await save("input.json", snapshot);
    console.log(`Input ready: ${snapshot.candidateName}, ${document.bytes.length} bytes`);
  } finally {
    await sql.end();
  }
}
async function runSide(side: string) {
  if (side !== "current" && side !== "reference") {
    throw new Error("Unknown side.");
  }
  const input: InputSnapshot = JSON.parse(await readFile(path.join(output, "input.json"), "utf-8"));
  const bytes = new Uint8Array(await readFile(path.join(output, "resume.pdf")));
  const base =
    side === "current"
      ? path.join(root, "apps/ai-recruitment-copilot-backend/src")
      : path.join(
          path.resolve(values["reference-root"]),
          "packages/resume-processing/src/internal",
        );
  const modules =
    side === "current"
      ? [
          "lib/server/resume-parse-pipeline.ts",
          "server/agents/resume-parser-agent.ts",
          "server/agents/resume-analysis-review.ts",
        ]
      : [
          "lib/resume-parse-pipeline.ts",
          "agents/resume-parser-agent.ts",
          "agents/resume-analysis-review.ts",
        ];
  let stage = "initialization";
  const requests: RequestMetric[] = [];
  const pending: Promise<void>[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes("/chat/completions")) {
      return originalFetch(url, init);
    }
    const body = JSON.parse(String(init?.body));
    const metric: RequestMetric = {
      endpoint: new URL(String(url)).origin,
      model: body.model,
      stage,
      thinkingDisabled: body.enable_thinking === false,
    };
    requests.push(metric);
    if (!metric.thinkingDisabled || "enableThinking" in body) {
      throw new Error(`${side}/${stage}: invalid thinking parameter`);
    }
    const started = performance.now();
    const response = await originalFetch(url, init);
    metric.status = response.status;
    pending.push(
      (async () => {
        try {
          const text = await response.clone().text();
          metric.durationMs = Math.round(performance.now() - started);
          if (!body.stream) {
            metric.usage = JSON.parse(text).usage;
          }
        } catch {
          /* Metrics must not interrupt generation, including error responses. */
        }
      })(),
    );
    return response;
  };
  const durations: Record<string, number> = {};
  async function timed<T>(name: string, operation: () => Promise<T>): Promise<T> {
    stage = name;
    console.log(`[${side}] ${name} started`);
    const started = performance.now();
    try {
      return await operation();
    } finally {
      durations[name] = Math.round(performance.now() - started);
      console.log(`[${side}] ${name}: ${durations[name]} ms`);
    }
  }
  let status = "failed";
  let errorMessage: string | undefined;
  const [pipeline, parser, review] = (await Promise.all(
    modules.map((file) => import(pathToFileURL(path.join(base, file)).href)),
  )) as [typeof CurrentPipeline, typeof CurrentParser, typeof CurrentReview];
  const started = performance.now();
  try {
    const ocr = await timed("ocr", () =>
      pipeline.extractResumeDocumentText({
        bytes,
        fileName: input.fileName,
        mediaType: "application/pdf",
      }),
    );
    await save(`${side}-ocr.json`, ocr);
    const structured = await timed("structure", () =>
      pipeline.generateResumeStructured(ocr.text, { fileName: input.fileName }),
    );
    await save(`${side}-structured.json`, structured);
    const result = await timed("review", () =>
      review.generateResumeReview({
        jobDescription: input.jobDescription,
        resumeProfile: parser.toResumeProfile(structured),
        resumeText: ocr.text,
      }),
    );
    await save(`${side}-review.json`, result);
    status = "success";
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${side}] failed: ${errorMessage.slice(0, 500)}`);
  } finally {
    durations.total = Math.round(performance.now() - started);
    await Promise.allSettled(pending);
    globalThis.fetch = originalFetch;
    await save(`${side}-metrics.json`, {
      durations,
      envPath,
      errorMessage,
      inputSha256: input.sha256,
      requests,
      runtime: process.version,
      side,
      status,
    });
  }
}
async function main() {
  await mkdir(output, { mode: 0o700, recursive: true });
  if (values.side) {
    await runSide(values.side);
    return;
  }
  await prepare();
  for (const side of ["current", "reference"]) {
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        import.meta.filename,
        "--side",
        side,
        "--env",
        envPath,
        "--output",
        output,
        "--reference-root",
        path.resolve(values["reference-root"]),
      ],
      { stdio: "inherit", timeout: 900_000 },
    );
    const [code, signal] = await once(child, "exit");
    if (code !== 0) {
      throw new Error(`${side} process stopped: ${signal ?? code}`);
    }
  }
  const metrics = await Promise.all(
    ["current", "reference"].map(async (side) =>
      JSON.parse(await readFile(path.join(output, `${side}-metrics.json`), "utf-8")),
    ),
  );
  await save("comparison.json", metrics);
  console.log(
    JSON.stringify(
      metrics.map(({ side, status, durations, requests }) => ({
        durations,
        requests: requests.length,
        side,
        status,
      })),
      null,
      2,
    ),
  );
  console.log(`Results: ${output}`);
  if (metrics.some((metric) => metric.status !== "success")) {
    process.exitCode = 1;
  }
}
await main();
