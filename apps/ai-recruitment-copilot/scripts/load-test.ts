import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

interface LoadConfig {
  baseUrl: string;
  durationSeconds: number;
  intervalMs: number;
  password: string;
  stage: string;
  targetPath: string;
  userCount: number;
}

interface TimingSample {
  durationMs: number;
  email: string;
  operation: "login" | "visit";
  success: boolean;
}

interface VirtualUser {
  context: BrowserContext;
  email: string;
  errors: string[];
  page: Page;
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].toSorted((left, right) => left - right);
  const index = Math.ceil(quantile * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, index)] ?? 0);
}

function summarize(samples: TimingSample[], operation: TimingSample["operation"]) {
  const selected = samples.filter((sample) => sample.operation === operation);
  const successful = selected.filter((sample) => sample.success);
  const durations = successful.map((sample) => sample.durationMs);
  return {
    attempted: selected.length,
    failed: selected.length - successful.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    succeeded: successful.length,
  };
}

function buildConfig(): LoadConfig {
  const password = process.env.LOAD_PASSWORD;
  if (!password) {
    throw new Error("LOAD_PASSWORD is required");
  }
  const baseUrl = (process.env.LOAD_BASE_URL ?? "https://recruitment.hirecopilot.bar").replace(
    /\/$/,
    "",
  );
  const userCount = readPositiveInteger("LOAD_USERS", 1);
  if (userCount > 50) {
    throw new Error("LOAD_USERS cannot exceed the 50 prepared accounts");
  }
  return {
    baseUrl,
    durationSeconds: readPositiveInteger("LOAD_DURATION_SECONDS", 60),
    intervalMs: readPositiveInteger("LOAD_INTERVAL_MS", 15_000),
    password,
    stage: process.env.LOAD_STAGE ?? "smoke",
    targetPath: process.env.LOAD_TARGET_PATH ?? "/w/world",
    userCount,
  };
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

async function createVirtualUser(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  index: number,
) {
  const suffix = String(index).padStart(3, "0");
  const email = `loadtest-user-${suffix}@example.com`;
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { height: 720, width: 1280 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    errors.push(
      `request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(`response: ${response.status()} ${response.url()}`);
    }
  });
  return { context, email, errors, page } satisfies VirtualUser;
}

async function loginUser(
  user: VirtualUser,
  config: LoadConfig,
  samples: TimingSample[],
): Promise<boolean> {
  const startedAt = performance.now();
  try {
    const response = await user.context.request.post(`${config.baseUrl}/api/auth/sign-in/email`, {
      data: { email: user.email, password: config.password },
      timeout: 30_000,
    });
    if (!response.ok()) {
      throw new Error(`Better Auth returned HTTP ${response.status()}`);
    }

    await user.page.goto(`${config.baseUrl}${config.targetPath}`, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
    const currentUrl = new URL(user.page.url());
    const reachedTarget =
      currentUrl.pathname === config.targetPath ||
      currentUrl.pathname.startsWith(`${config.targetPath}/`);
    if (currentUrl.origin !== config.baseUrl || !reachedTarget) {
      throw new Error(`session verification redirected to ${currentUrl.pathname}`);
    }
    samples.push({
      durationMs: elapsedMs(startedAt),
      email: user.email,
      operation: "login",
      success: true,
    });
    return true;
  } catch (error) {
    user.errors.push(`login: ${error instanceof Error ? error.message : String(error)}`);
    samples.push({
      durationMs: elapsedMs(startedAt),
      email: user.email,
      operation: "login",
      success: false,
    });
    return false;
  }
}

async function visitTarget(user: VirtualUser, config: LoadConfig, samples: TimingSample[]) {
  const startedAt = performance.now();
  try {
    const response = await user.page.goto(`${config.baseUrl}${config.targetPath}`, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });
    const success =
      Boolean(response?.ok()) && user.page.url().startsWith(`${config.baseUrl}/w/world`);
    samples.push({
      durationMs: elapsedMs(startedAt),
      email: user.email,
      operation: "visit",
      success,
    });
  } catch (error) {
    user.errors.push(`visit: ${error instanceof Error ? error.message : String(error)}`);
    samples.push({
      durationMs: elapsedMs(startedAt),
      email: user.email,
      operation: "visit",
      success: false,
    });
  }
}

async function main() {
  const config = buildConfig();
  const runStartedAt = new Date();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const users: VirtualUser[] = [];
  const samples: TimingSample[] = [];

  try {
    for (let index = 1; index <= config.userCount; index += 1) {
      users.push(await createVirtualUser(browser, index));
    }

    const loginResults = await Promise.all(users.map((user) => loginUser(user, config, samples)));
    const activeUsers = users.filter((_, index) => loginResults[index]);
    const stageEndsAt = Date.now() + config.durationSeconds * 1000;

    while (Date.now() < stageEndsAt && activeUsers.length > 0) {
      await Promise.all(activeUsers.map((user) => visitTarget(user, config, samples)));
      const remainingMs = stageEndsAt - Date.now();
      if (remainingMs > 0) {
        await delay(Math.min(config.intervalMs, remainingMs));
      }
    }

    const report = {
      config: {
        baseUrl: config.baseUrl,
        durationSeconds: config.durationSeconds,
        intervalMs: config.intervalMs,
        stage: config.stage,
        targetPath: config.targetPath,
        userCount: config.userCount,
      },
      finishedAt: new Date().toISOString(),
      login: summarize(samples, "login"),
      startedAt: runStartedAt.toISOString(),
      users: users.map((user) => ({ email: user.email, errors: user.errors })),
      visit: summarize(samples, "visit"),
    };
    const outputDirectory = resolve(process.cwd(), "artifacts/load-test");
    await mkdir(outputDirectory, { recursive: true });
    const timestamp = runStartedAt.toISOString().replaceAll(":", "-");
    const outputPath = resolve(outputDirectory, `${timestamp}-${config.stage}.json`);
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ outputPath, ...report }, null, 2));

    if (report.login.failed > 0 || report.visit.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await Promise.allSettled(users.map((user) => user.context.close()));
    await browser.close();
  }
}

await main();
