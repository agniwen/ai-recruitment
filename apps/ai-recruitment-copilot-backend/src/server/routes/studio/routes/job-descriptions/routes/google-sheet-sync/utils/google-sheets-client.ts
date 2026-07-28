import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

import { EnvHttpProxyAgent, fetch } from "undici";

const googleDispatcher = new EnvHttpProxyAgent();

interface GoogleServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri: string;
}

interface GoogleSheetsConfig {
  credentials: GoogleServiceAccountCredentials;
  sheetName: string;
  spreadsheetId: string;
}

export class GoogleSheetsError extends Error {
  readonly kind: "configuration" | "request";

  constructor(message: string, kind: "configuration" | "request") {
    super(message);
    this.kind = kind;
    this.name = "GoogleSheetsError";
  }
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function parseCredentials(value: string): GoogleServiceAccountCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new GoogleSheetsError("Google Sheets 服务账号配置不是有效 JSON。", "configuration");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new GoogleSheetsError("Google Sheets 服务账号配置无效。", "configuration");
  }
  const candidate = parsed as Partial<GoogleServiceAccountCredentials>;
  if (!(candidate.client_email && candidate.private_key && candidate.token_uri)) {
    throw new GoogleSheetsError("Google Sheets 服务账号配置缺少必要字段。", "configuration");
  }
  return {
    client_email: candidate.client_email,
    private_key: candidate.private_key,
    token_uri: candidate.token_uri,
  };
}

async function loadGoogleSheetsConfig(): Promise<GoogleSheetsConfig> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new GoogleSheetsError("未配置 GOOGLE_SHEETS_SPREADSHEET_ID。", "configuration");
  }

  const inlineCredentials = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON?.trim();
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  let credentialsJson = inlineCredentials;
  if (!credentialsJson && credentialsPath) {
    try {
      credentialsJson = await readFile(credentialsPath, "utf-8");
    } catch {
      throw new GoogleSheetsError("无法读取 GOOGLE_APPLICATION_CREDENTIALS。", "configuration");
    }
  }
  if (!credentialsJson) {
    throw new GoogleSheetsError(
      "未配置 GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON 或 GOOGLE_APPLICATION_CREDENTIALS。",
      "configuration",
    );
  }

  return {
    credentials: parseCredentials(credentialsJson),
    sheetName: process.env.GOOGLE_SHEETS_SHEET_NAME?.trim() || "汇总表",
    spreadsheetId,
  };
}

async function requestAccessToken(credentials: GoogleServiceAccountCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const encodedClaim = base64url(
    JSON.stringify({
      aud: credentials.token_uri,
      exp: now + 3600,
      iat: now,
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${encodedHeader}.${encodedClaim}`);
  const signature = signer.sign(credentials.private_key).toString("base64url");
  const assertion = `${encodedHeader}.${encodedClaim}.${signature}`;

  const response = await fetch(credentials.token_uri, {
    body: new URLSearchParams({
      assertion,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    }),
    dispatcher: googleDispatcher,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new GoogleSheetsError(`Google OAuth 请求失败（${response.status}）。`, "request");
  }
  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new GoogleSheetsError("Google OAuth 响应缺少访问令牌。", "request");
  }
  return payload.access_token;
}

export async function readConfiguredGoogleSheetValues(): Promise<unknown[][]> {
  const config = await loadGoogleSheetsConfig();
  const accessToken = await requestAccessToken(config.credentials);
  const escapedSheetName = config.sheetName.replaceAll("'", "''");
  const range = encodeURIComponent(`'${escapedSheetName}'`);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}` +
    `/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE` +
    "&dateTimeRenderOption=FORMATTED_STRING";
  const response = await fetch(url, {
    dispatcher: googleDispatcher,
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new GoogleSheetsError(`Google Sheets 读取失败（${response.status}）。`, "request");
  }
  const payload = (await response.json()) as { values?: unknown };
  if (!Array.isArray(payload.values)) {
    return [];
  }
  return payload.values.filter(Array.isArray);
}
