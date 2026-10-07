import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { Effect } from "effect";
import {
  DEFAULT_CALENDAR_SYNC_LABEL,
  DEFAULT_LOCAL_CONFIG,
  DEFAULT_MANAGED_OAUTH_CLIENT,
  DEFAULT_OAUTH_TOKEN,
  DEFAULT_SERVICE_ACCOUNT,
  GOOGLE_CALENDAR_SCOPE,
  discoverOAuthClientFile,
  ensureManagedOAuthClientFile,
  loadCalendarDefinition,
  loadLocalConfig,
  readInstalledClient,
  readUserToken,
  saveLocalConfig
} from "./config.js";
import type {
  AuthMode,
  InstalledOAuthClient,
  LoadedCalendarDefinition,
  LocalConfig,
  ResolvedCalendarEvent,
  SyncOptions
} from "./types.js";
import {
  CliError,
  effectPromise,
  effectSync,
  expandHome,
  fail,
  fileExists,
  readJsonUnknown,
  removeFileIfExists,
  writeJsonFile
} from "./utils.js";

interface ApiResult {
  ok: boolean;
  status: number;
  data: unknown;
}

interface RuntimeContext {
  definition: LoadedCalendarDefinition;
  localConfig: LocalConfig;
  localConfigFile: string;
  authMode: Exclude<AuthMode, "auto">;
  calendarId: string;
  impersonate: string;
  oauthClientSecretsFile: string;
  oauthTokenFile: string;
  serviceAccountFile: string;
}

interface GoogleCalendarEvent {
  id?: string;
  summary?: string;
  status?: string;
  start?: {
    date?: string;
    dateTime?: string;
  };
  end?: {
    date?: string;
    dateTime?: string;
  };
  extendedProperties?: {
    private?: Record<string, string>;
  };
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createPkcePair() {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function randomState() {
  return b64url(crypto.randomBytes(24));
}

export function stableGoogleEventId(identityKey: string) {
  return `lgs${crypto.createHash("sha1").update(identityKey).digest("hex")}`;
}

function eventStartValue(event: Pick<ResolvedCalendarEvent, "timeKind" | "start"> | GoogleCalendarEvent) {
  if ("timeKind" in event) return event.start;
  return event.start?.dateTime || event.start?.date || "";
}

function sameEventStart(left: string, right: string) {
  if (left === right) return true;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return false;
  return leftTime === rightTime;
}

export function apiRequest(token: string, method: string, url: string, body: unknown = null) {
  return effectPromise(`google api ${method} ${url}`, async (): Promise<ApiResult> => {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    return { ok: response.ok, status: response.status, data };
  });
}

function listCalendarEvents(
  token: string,
  calendarId: string,
  searchParams: Record<string, string | undefined>
) {
  return Effect.gen(function* () {
    const allItems: GoogleCalendarEvent[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < 50; page += 1) {
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
      for (const [key, value] of Object.entries(searchParams)) {
        if (value) url.searchParams.set(key, value);
      }
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const result = yield* apiRequestWithRetry(token, "GET", url.toString());
      if (!result.ok) {
        return yield* Effect.fail(
          fail(`Failed to list calendar events: ${result.status} ${JSON.stringify(result.data)}`)
        );
      }

      const data = result.data as Record<string, unknown>;
      const items = Array.isArray(data.items) ? (data.items as GoogleCalendarEvent[]) : [];
      allItems.push(...items);

      const next = typeof data.nextPageToken === "string" ? data.nextPageToken : "";
      if (!next) break;
      pageToken = next;
    }

    return allItems;
  });
}

function deleteCalendarEvent(token: string, calendarId: string, eventId: string) {
  return Effect.gen(function* () {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`;
    const result = yield* apiRequestWithRetry(token, "DELETE", url);
    if (!(result.ok || result.status === 404 || result.status === 410)) {
      return yield* Effect.fail(
        fail(`Failed to delete duplicate event ${eventId}: ${result.status} ${JSON.stringify(result.data)}`)
      );
    }
  });
}

function pruneSyncIdDuplicates(
  token: string,
  calendarId: string,
  event: ResolvedCalendarEvent
) {
  return Effect.gen(function* () {
    const canonicalId = stableGoogleEventId(event.identityKey);
    const syncMatches = yield* listCalendarEvents(token, calendarId, {
      privateExtendedProperty: `sync_id=${event.id}`,
      singleEvents: "false",
      maxResults: "50"
    });

    for (const duplicate of syncMatches) {
      if (!duplicate.id || duplicate.id === canonicalId) continue;
      if (duplicate.status === "cancelled") continue;
      yield* deleteCalendarEvent(token, calendarId, duplicate.id);
      console.log(`removed-duplicate\t${event.id}\t${duplicate.id}`);
    }

    const startValue = eventStartValue(event);
    if (!startValue) return;

    const startDate = new Date(startValue);
    if (Number.isNaN(startDate.valueOf())) return;
    const rangeStart = new Date(startDate.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const rangeEnd = new Date(startDate.getTime() + 12 * 60 * 60 * 1000).toISOString();
    const nearby = yield* listCalendarEvents(token, calendarId, {
      singleEvents: "false",
      maxResults: "50",
      timeMin: rangeStart,
      timeMax: rangeEnd
    });
    const summaryMatches = yield* listCalendarEvents(token, calendarId, {
      singleEvents: "false",
      maxResults: "50",
      q: event.summary
    });
    const candidates = [...nearby, ...summaryMatches];
    const seenCandidateIds = new Set<string>();

    for (const candidate of candidates) {
      if (!candidate.id || candidate.id === canonicalId) continue;
      if (candidate.status === "cancelled") continue;
      if (seenCandidateIds.has(candidate.id)) continue;
      seenCandidateIds.add(candidate.id);
      if ((candidate.summary || "") !== event.summary) continue;
      if (!sameEventStart(eventStartValue(candidate), startValue)) continue;
      const privateProps = candidate.extendedProperties?.private ?? {};
      if (privateProps.sync_id === event.id) continue;
      if (privateProps.source === "linear-gsuite") continue;
      yield* deleteCalendarEvent(token, calendarId, candidate.id);
      console.log(`removed-orphan\t${event.id}\t${candidate.id}`);
    }
  });
}

function sleep(ms: number) {
  return effectPromise(`sleep ${ms}`, () => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

function withRetry<A>(label: string, effectFactory: () => Effect.Effect<A, CliError>, attempts = 3) {
  return Effect.gen(function* () {
    let lastError: CliError | undefined;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const exit = yield* Effect.result(effectFactory());
      if (exit._tag === "Success") return exit.success;
      lastError = exit.failure;
      if (attempt < attempts) yield* sleep(attempt * 500);
    }
    return yield* Effect.fail(lastError ?? fail(`${label}: retry exhausted`));
  });
}

function apiRequestWithRetry(token: string, method: string, url: string, body: unknown = null) {
  return Effect.gen(function* () {
    let lastResult: ApiResult | undefined;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = yield* Effect.result(apiRequest(token, method, url, body));
      if (result._tag === "Success") {
        lastResult = result.success;
        if (lastResult.status === 429 || lastResult.status >= 500) {
          if (attempt < 3) yield* sleep(attempt * 500);
          continue;
        }
        return lastResult;
      }
      if (attempt < 3) yield* sleep(attempt * 500);
      else return yield* Effect.fail(result.failure);
    }
    return yield* Effect.fail(fail(`Request failed without result: ${method} ${url}`));
  });
}

function pickRedirectBase(client: InstalledOAuthClient): string {
  const candidates = client.redirect_uris ?? [];
  const localhost = candidates.find((uri) => uri === "http://localhost" || uri.startsWith("http://localhost:"));
  if (localhost) return "http://localhost";
  const loopback = candidates.find((uri) => uri === "http://127.0.0.1" || uri.startsWith("http://127.0.0.1:"));
  if (loopback) return "http://127.0.0.1";
  if (candidates[0]) return candidates[0];
  return "http://localhost";
}

function openUrl(url: string) {
  try {
    const child = spawn("open", [url], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  } catch {
    // Manual copy/paste remains available.
  }
}

function waitForOAuthCallback(client: InstalledOAuthClient) {
  return effectPromise("start oauth listener", async () => {
    const redirectBase = pickRedirectBase(client);
    const state = randomState();
    const { verifier, challenge } = createPkcePair();
    const host = new URL(redirectBase).hostname;

    return await new Promise<{
      authUrl: string;
      waitForCallback: () => Promise<{ code: string; redirectUri: string; verifier: string }>;
    }>((resolve, reject) => {
      let redirectUri = "";
      const server = http.createServer();

      server.listen(0, host, () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close(() => reject(new Error("Failed to bind OAuth callback listener.")));
          return;
        }

        redirectUri = `${redirectBase}:${address.port}`;
        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.searchParams.set("client_id", client.client_id);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
        authUrl.searchParams.set("access_type", "offline");
        authUrl.searchParams.set("prompt", "consent");
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", challenge);
        authUrl.searchParams.set("code_challenge_method", "S256");

        resolve({
          authUrl: authUrl.toString(),
          waitForCallback: async () => {
            return await new Promise<{ code: string; redirectUri: string; verifier: string }>((resolveCallback, rejectCallback) => {
              const timeout = setTimeout(() => {
                server.close(() => rejectCallback(new Error("Timed out waiting for Google OAuth redirect.")));
              }, 5 * 60 * 1000);

              server.on("request", (request, response) => {
                const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);
                const returnedState = requestUrl.searchParams.get("state");
                const code = requestUrl.searchParams.get("code");
                const error = requestUrl.searchParams.get("error");

                if (error) {
                  response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
                  response.end("<h1>Google Calendar authorization failed.</h1><p>You can close this tab.</p>");
                  clearTimeout(timeout);
                  server.close(() => rejectCallback(new Error(`Google OAuth error: ${error}`)));
                  return;
                }

                if (!code || returnedState !== state) {
                  response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
                  response.end("<h1>Invalid OAuth callback.</h1><p>You can close this tab.</p>");
                  clearTimeout(timeout);
                  server.close(() => rejectCallback(new Error("Invalid OAuth callback state.")));
                  return;
                }

                response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                response.end("<h1>linear-gsuite linked.</h1><p>You can close this tab and return to the terminal.</p>");
                clearTimeout(timeout);
                server.close(() => resolveCallback({ code, redirectUri, verifier }));
              });
            });
          }
        });
      });
    });
  });
}

function exchangeOAuthCode(client: InstalledOAuthClient, code: string, verifier: string, redirectUri: string) {
  return effectPromise("exchange oauth code", async () => {
    const body = new URLSearchParams({
      client_id: client.client_id,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    });
    if (client.client_secret) {
      body.set("client_secret", client.client_secret);
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Google OAuth token exchange failed: ${response.status} ${JSON.stringify(data)}`);
    }
    return data as Record<string, unknown>;
  });
}

export function refreshUserAccessToken(clientFile: string, tokenFile = DEFAULT_OAUTH_TOKEN) {
  return Effect.gen(function* () {
    const installed = yield* readInstalledClient(clientFile);
    const token = yield* readUserToken(tokenFile);
    if (!token.refresh_token) {
      return yield* Effect.fail(fail(`Token file is missing a refresh token: ${tokenFile}`));
    }

    const body = new URLSearchParams({
      client_id: installed.client_id,
      grant_type: "refresh_token",
      refresh_token: token.refresh_token
    });
    if (installed.client_secret) {
      body.set("client_secret", installed.client_secret);
    }

    const data = yield* effectPromise("refresh user token", async () => {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`User token refresh failed: ${response.status} ${JSON.stringify(payload)}`);
      }
      return payload as Record<string, unknown>;
    });

    return {
      accessToken: String(data.access_token),
      token: {
        ...token,
        access_token: String(data.access_token),
        token_type: typeof data.token_type === "string" ? data.token_type : token.token_type ?? "Bearer",
        scope: typeof data.scope === "string" ? data.scope : token.scope ?? GOOGLE_CALENDAR_SCOPE,
        expires_at: new Date(Date.now() + (typeof data.expires_in === "number" ? data.expires_in : 3600) * 1000).toISOString(),
        issued_at: new Date().toISOString()
      },
      client: installed
    };
  });
}

export function fetchServiceAccountAccessToken(serviceAccountFile: string, impersonate = "") {
  return Effect.gen(function* () {
    const serviceAccount = yield* readJsonUnknown(serviceAccountFile);
    if (
      typeof serviceAccount !== "object" ||
      serviceAccount === null ||
      typeof (serviceAccount as Record<string, unknown>).client_email !== "string" ||
      typeof (serviceAccount as Record<string, unknown>).private_key !== "string"
    ) {
      return yield* Effect.fail(fail(`Expected service account JSON in ${serviceAccountFile}`));
    }

    const payload = serviceAccount as Record<string, string>;
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const claim: Record<string, string | number> = {
      iss: payload.client_email,
      scope: GOOGLE_CALENDAR_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now
    };
    if (impersonate) claim.sub = impersonate;

    const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(unsigned);
    const signature = signer
      .sign(payload.private_key, "base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const assertion = `${unsigned}.${signature}`;

    const data = yield* effectPromise("fetch service account token", async () => {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion
        })
      });
      const payloadData = await response.json();
      if (!response.ok) {
        throw new Error(`Service-account token request failed: ${response.status} ${JSON.stringify(payloadData)}`);
      }
      return payloadData as Record<string, unknown>;
    });

    return {
      accessToken: String(data.access_token),
      serviceAccount: payload
    };
  });
}

function resolveRuntime(options: SyncOptions, cwd = process.cwd()) {
  return Effect.gen(function* () {
    const definition = yield* loadCalendarDefinition(options.configFile, cwd);
    const localConfig = yield* loadLocalConfig(options.localConfigFile);

    let discoveredOAuthClient = "";
    const probe = yield* Effect.result(discoverOAuthClientFile(options.oauthClientSecretsFile || localConfig.oauthClientFile || ""));
    if (probe._tag === "Success") discoveredOAuthClient = probe.success;

    let authMode: Exclude<AuthMode, "auto">;
    if (options.authMode === "auto") {
      if (localConfig.authMode) authMode = localConfig.authMode;
      else if (fileExists(options.oauthTokenFile || localConfig.oauthTokenFile || DEFAULT_OAUTH_TOKEN) || Boolean(discoveredOAuthClient)) authMode = "user";
      else authMode = "service-account";
    } else {
      authMode = options.authMode;
    }

    const oauthClientSecretsFile = authMode === "user"
      ? yield* ensureManagedOAuthClientFile(
          discoveredOAuthClient || (yield* discoverOAuthClientFile(options.oauthClientSecretsFile || localConfig.oauthClientFile || "")),
          localConfig.oauthClientManagedFile || DEFAULT_MANAGED_OAUTH_CLIENT
        )
      : localConfig.oauthClientManagedFile || DEFAULT_MANAGED_OAUTH_CLIENT;

    return {
      definition,
      localConfig,
      localConfigFile: expandHome(options.localConfigFile),
      authMode,
      calendarId:
        options.calendarId ||
        localConfig.calendarId ||
        definition.calendarId ||
        (authMode === "user" ? "primary" : ""),
      impersonate: options.impersonate || localConfig.impersonate || "",
      oauthClientSecretsFile,
      oauthTokenFile: expandHome(options.oauthTokenFile || localConfig.oauthTokenFile || DEFAULT_OAUTH_TOKEN),
      serviceAccountFile: expandHome(options.serviceAccountFile || localConfig.serviceAccountFile || DEFAULT_SERVICE_ACCOUNT)
    } satisfies RuntimeContext;
  });
}

function fetchRuntimeAccessToken(runtime: RuntimeContext): Effect.Effect<{ accessToken: string }, CliError> {
  return withRetry("fetch runtime access token", (): Effect.Effect<{ accessToken: string }, CliError> => {
    if (runtime.authMode === "user") {
      if (!fileExists(runtime.oauthTokenFile)) {
        return Effect.fail(
          fail(`User OAuth token file not found: ${runtime.oauthTokenFile}. Run: linear-gsuite auth login`)
        );
      }
      return Effect.map(
        refreshUserAccessToken(runtime.oauthClientSecretsFile, runtime.oauthTokenFile),
        (result) => ({ accessToken: result.accessToken })
      );
    }

    return Effect.map(
      fetchServiceAccountAccessToken(runtime.serviceAccountFile, runtime.impersonate),
      (result) => ({ accessToken: result.accessToken })
    );
  });
}

function buildEventResource(definition: LoadedCalendarDefinition, event: ResolvedCalendarEvent) {
  const googleEventId = stableGoogleEventId(event.identityKey);
  const base = {
    id: googleEventId,
    summary: event.summary,
    description: event.description,
    recurrence: event.recurrence.length > 0 ? event.recurrence : undefined,
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: event.reminders.email },
        { method: "popup", minutes: event.reminders.popup }
      ]
    },
    extendedProperties: {
      private: {
        source: "linear-gsuite",
        sync_id: event.id,
        source_id: event.sourceId,
        google_event_id: googleEventId
      }
    }
  };

  if (event.timeKind === "allDay") {
    return {
      ...base,
      start: { date: event.start },
      end: { date: event.end }
    };
  }

  return {
    ...base,
    start: {
      dateTime: event.start,
      timeZone: definition.timezone
    },
    end: {
      dateTime: event.end,
      timeZone: definition.timezone
    }
  };
}

function printErrorHints(result: ApiResult) {
  const error = typeof result.data === "object" && result.data !== null ? (result.data as Record<string, unknown>).error : undefined;
  const details = Array.isArray((error as Record<string, unknown> | undefined)?.details)
    ? ((error as Record<string, unknown>).details as Array<Record<string, unknown>>)
    : [];
  const errorInfo = details.find((detail) => detail["@type"] === "type.googleapis.com/google.rpc.ErrorInfo");
  if (errorInfo?.metadata && typeof errorInfo.metadata === "object") {
    const metadata = errorInfo.metadata as Record<string, unknown>;
    if (typeof metadata.consumer === "string") console.log(`Consumer project: ${metadata.consumer}`);
    if (typeof metadata.activationUrl === "string") console.log(`Activation URL: ${metadata.activationUrl}`);
  }
  if (result.status === 403 && errorInfo?.reason === "SERVICE_DISABLED") {
    console.log("Hint: this auth path is still bound to the Google project shown above.");
  }
  console.log(JSON.stringify(result.data, null, 2));
}

export function authStatus(options: {
  clientSecretsFile?: string;
  tokenFile?: string;
  localConfigFile: string;
}) {
  return Effect.gen(function* () {
    const localConfig = yield* loadLocalConfig(options.localConfigFile);
    const discovered = yield* discoverOAuthClientFile(options.clientSecretsFile || localConfig.oauthClientFile || "");
    const clientSecretsFile = yield* ensureManagedOAuthClientFile(discovered, localConfig.oauthClientManagedFile || DEFAULT_MANAGED_OAUTH_CLIENT);
    const tokenFile = expandHome(options.tokenFile || localConfig.oauthTokenFile || DEFAULT_OAUTH_TOKEN);
    const client = yield* readInstalledClient(clientSecretsFile);

    console.log(`Local config: ${options.localConfigFile}`);
    console.log(`Client secrets: ${clientSecretsFile}`);
    console.log(`Token file: ${tokenFile}`);
    console.log(`Project: ${client.project_id ?? "(unknown)"}`);
    console.log(`Client ID: ${client.client_id}`);

    if (!fileExists(tokenFile)) {
      console.log("Token status: missing");
      return yield* Effect.fail(fail("Google OAuth token is missing."));
    }

    const { accessToken, token } = yield* refreshUserAccessToken(clientSecretsFile, tokenFile);
    const result = yield* apiRequest(accessToken, "GET", "https://www.googleapis.com/calendar/v3/users/me/calendarList");
    console.log("Token status: refresh ok");
    console.log(`Granted scope: ${token.scope || "(unknown)"}`);
    console.log(`Calendar API status: ${result.status}`);
    if (!result.ok) {
      console.log(JSON.stringify(result.data, null, 2));
      return yield* Effect.fail(fail("Calendar API probe failed."));
    }

    const count = Array.isArray((result.data as Record<string, unknown>).items)
      ? ((result.data as Record<string, unknown>).items as unknown[]).length
      : 0;
    console.log(`Accessible calendars: ${count}`);
  });
}

export function authLogin(options: {
  clientSecretsFile?: string;
  tokenFile?: string;
  localConfigFile: string;
  openBrowser: boolean;
}) {
  return Effect.gen(function* () {
    const localConfig = yield* loadLocalConfig(options.localConfigFile);
    const discovered = yield* discoverOAuthClientFile(options.clientSecretsFile || localConfig.oauthClientFile || "");
    const clientSecretsFile = yield* ensureManagedOAuthClientFile(discovered, localConfig.oauthClientManagedFile || DEFAULT_MANAGED_OAUTH_CLIENT);
    const tokenFile = expandHome(options.tokenFile || localConfig.oauthTokenFile || DEFAULT_OAUTH_TOKEN);
    const client = yield* readInstalledClient(clientSecretsFile);
    const session = yield* waitForOAuthCallback(client);

    console.log(`Client secrets: ${clientSecretsFile}`);
    console.log(`Token file: ${tokenFile}`);
    console.log(`Project: ${client.project_id ?? "(unknown)"}`);
    console.log(`Open this URL if the browser does not launch automatically:\n${session.authUrl}`);
    if (options.openBrowser) openUrl(session.authUrl);

    const { code, redirectUri, verifier } = yield* effectPromise("wait for oauth callback", () => session.waitForCallback());
    const tokenResponse = yield* exchangeOAuthCode(client, code, verifier, redirectUri);
    const token = {
      access_token: String(tokenResponse.access_token),
      refresh_token: String(tokenResponse.refresh_token),
      token_type: typeof tokenResponse.token_type === "string" ? tokenResponse.token_type : "Bearer",
      scope: typeof tokenResponse.scope === "string" ? tokenResponse.scope : GOOGLE_CALENDAR_SCOPE,
      expires_at: new Date(Date.now() + (typeof tokenResponse.expires_in === "number" ? tokenResponse.expires_in : 3600) * 1000).toISOString(),
      issued_at: new Date().toISOString()
    };

    yield* writeJsonFile(tokenFile, token);
    yield* saveLocalConfig(
      {
        authMode: "user",
        oauthClientFile: clientSecretsFile,
        oauthClientManagedFile: clientSecretsFile,
        oauthTokenFile: tokenFile
      },
      options.localConfigFile
    );

    const { accessToken } = yield* refreshUserAccessToken(clientSecretsFile, tokenFile);
    const result = yield* apiRequest(accessToken, "GET", "https://www.googleapis.com/calendar/v3/users/me/calendarList");
    if (!result.ok) {
      return yield* Effect.fail(
        fail(`Authorized, but Calendar API probe failed: ${result.status} ${JSON.stringify(result.data)}`)
      );
    }

    const count = Array.isArray((result.data as Record<string, unknown>).items)
      ? ((result.data as Record<string, unknown>).items as unknown[]).length
      : 0;
    console.log("Google Calendar desktop OAuth is configured.");
    console.log(`Saved token: ${tokenFile}`);
    console.log(`Accessible calendars: ${count}`);
  });
}

export function authLogout(options: { tokenFile?: string; localConfigFile: string }) {
  return Effect.gen(function* () {
    const localConfig = yield* loadLocalConfig(options.localConfigFile);
    const tokenFile = expandHome(options.tokenFile || localConfig.oauthTokenFile || DEFAULT_OAUTH_TOKEN);
    yield* removeFileIfExists(tokenFile);
    console.log(`Removed token file: ${tokenFile}`);
  });
}

export function calendarDoctor(options: SyncOptions, cwd = process.cwd()) {
  return Effect.gen(function* () {
    const runtime = yield* resolveRuntime(options, cwd);
    console.log(`Event config: ${runtime.definition.configFile}`);
    console.log(`Local config: ${runtime.localConfigFile}`);
    console.log(`Config format: ${runtime.definition.format}`);
    console.log(`Enabled calendar sources: ${runtime.definition.sources.length}`);
    for (const source of runtime.definition.sources) {
      console.log(`- ${source.id} | ${source.type} | events=${source.eventCount} | ${source.path ?? "(virtual)"}`);
    }
    console.log(`Merged event count: ${runtime.definition.events.length}`);
    console.log(`Launchd label: ${runtime.definition.agents?.["calendar-sync"]?.label ?? DEFAULT_CALENDAR_SYNC_LABEL}`);
    console.log(`Launchd interval: ${runtime.definition.agents?.["calendar-sync"]?.startIntervalSeconds ?? 21600}s`);
    console.log(`Auth mode: ${runtime.authMode}`);
    console.log(`Configured calendarId: ${runtime.calendarId || "(missing)"}`);
    if (runtime.authMode === "user") {
      console.log(`OAuth client: ${runtime.oauthClientSecretsFile}`);
      console.log(`OAuth token: ${runtime.oauthTokenFile}`);
    } else {
      const serviceAccount = yield* readJsonUnknown(runtime.serviceAccountFile);
      const account = serviceAccount as Record<string, unknown>;
      console.log(`Service account: ${String(account.client_email ?? "(missing)")}`);
      console.log(`Project: ${String(account.project_id ?? "(missing)")}`);
      console.log(`Service account client_id: ${String(account.client_id ?? "(missing)")}`);
    }

    const token = yield* fetchRuntimeAccessToken(runtime);
    console.log("Token mint: ok");
    const result = yield* apiRequestWithRetry(token.accessToken, "GET", "https://www.googleapis.com/calendar/v3/users/me/calendarList");
    console.log(`Calendar API status: ${result.status}`);
    if (!result.ok) {
      printErrorHints(result);
      return yield* Effect.fail(fail("Calendar API doctor failed."));
    }

    const items = Array.isArray((result.data as Record<string, unknown>).items)
      ? ((result.data as Record<string, unknown>).items as Array<Record<string, unknown>>)
      : [];
    console.log(`Accessible calendars: ${items.length}`);
    for (const item of items.slice(0, 20)) {
      console.log(`- ${String(item.id)} | ${String(item.summary)} | access=${String(item.accessRole)}`);
    }
  });
}

export function listCalendars(options: SyncOptions, cwd = process.cwd()) {
  return Effect.gen(function* () {
    const runtime = yield* resolveRuntime(options, cwd);
    const token = yield* fetchRuntimeAccessToken(runtime);
    const result = yield* apiRequestWithRetry(token.accessToken, "GET", "https://www.googleapis.com/calendar/v3/users/me/calendarList");
    if (!result.ok) {
      printErrorHints(result);
      return yield* Effect.fail(fail("Failed to list calendars."));
    }
    const items = Array.isArray((result.data as Record<string, unknown>).items)
      ? ((result.data as Record<string, unknown>).items as Array<Record<string, unknown>>)
      : [];
    for (const item of items) {
      console.log(`${String(item.id)}\t${String(item.summary)}\t${String(item.accessRole)}`);
    }
  });
}

export function setCalendarId(calendarId: string, localConfigFile: string) {
  return Effect.gen(function* () {
    yield* saveLocalConfig({ calendarId }, localConfigFile);
    console.log(`Saved calendarId ${calendarId} in ${expandHome(localConfigFile)}`);
  });
}

export function showSyncedEvents(localConfigFile: string) {
  return Effect.gen(function* () {
    const localConfig = yield* loadLocalConfig(localConfigFile);
    const clientFile =
      localConfig.oauthClientManagedFile ||
      localConfig.oauthClientFile ||
      (fileExists(DEFAULT_MANAGED_OAUTH_CLIENT) ? DEFAULT_MANAGED_OAUTH_CLIENT : "");
    if (!clientFile) {
      return yield* Effect.fail(
        fail(`No oauth client available in ${expandHome(localConfigFile)} or ${DEFAULT_MANAGED_OAUTH_CLIENT}. Run auth login first.`)
      );
    }
    const tokenFile = localConfig.oauthTokenFile || DEFAULT_OAUTH_TOKEN;
    const { accessToken } = yield* refreshUserAccessToken(clientFile, tokenFile);
    const calendarId = localConfig.calendarId || "primary";
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("privateExtendedProperty", "source=linear-gsuite");
    url.searchParams.set("singleEvents", "false");
    url.searchParams.set("maxResults", "100");
    const result = yield* apiRequest(accessToken, "GET", url.toString());
    if (!result.ok) {
      return yield* Effect.fail(fail(`Failed to list synced events: ${result.status} ${JSON.stringify(result.data)}`));
    }
    const items = Array.isArray((result.data as Record<string, unknown>).items)
      ? ((result.data as Record<string, unknown>).items as Array<Record<string, unknown>>)
      : [];
    console.log(`calendarId: ${calendarId}`);
    console.log(`synced events: ${items.length}`);
    for (const item of items) {
      const start = (item.start as Record<string, unknown> | undefined) ?? {};
      console.log(`${String(item.summary)}\t${String(start.dateTime ?? start.date ?? "")}\t${String(item.id)}`);
    }
  });
}

export function syncCalendar(options: SyncOptions, cwd = process.cwd()) {
  return Effect.gen(function* () {
    const runtime = yield* resolveRuntime(options, cwd);
    if (!runtime.calendarId) {
      return yield* Effect.fail(
        fail("No calendar ID configured. Use calendar set-calendar, pass --calendar-id, or rely on the user-auth default primary calendar.")
      );
    }

    const token = yield* fetchRuntimeAccessToken(runtime);

    for (const event of runtime.definition.events) {
      const googleEventId = stableGoogleEventId(event.identityKey);
      const resource = buildEventResource(runtime.definition, event);
      if (options.dryRun) {
        console.log(`would-sync\t${event.id}`);
        continue;
      }

      const getUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(runtime.calendarId)}/events/${encodeURIComponent(googleEventId)}`;
      const existing = yield* apiRequestWithRetry(token.accessToken, "GET", getUrl);
      if (existing.ok) {
        const update = yield* apiRequestWithRetry(
          token.accessToken,
          "PUT",
          `${getUrl}?sendUpdates=none`,
          resource
        );
        if (!update.ok) {
          return yield* Effect.fail(fail(`Failed to update ${event.id}: ${update.status} ${JSON.stringify(update.data)}`));
        }
        yield* pruneSyncIdDuplicates(token.accessToken, runtime.calendarId, event);
        console.log(`updated\t${event.id}`);
        continue;
      }

      if (existing.status !== 404) {
        return yield* Effect.fail(fail(`Failed to inspect ${event.id}: ${existing.status} ${JSON.stringify(existing.data)}`));
      }

      const create = yield* apiRequestWithRetry(
        token.accessToken,
        "POST",
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(runtime.calendarId)}/events?sendUpdates=none`,
        resource
      );
      if (!create.ok) {
        return yield* Effect.fail(fail(`Failed to create ${event.id}: ${create.status} ${JSON.stringify(create.data)}`));
      }
      yield* pruneSyncIdDuplicates(token.accessToken, runtime.calendarId, event);
      console.log(`created\t${event.id}`);
    }

    const removedCount = yield* reconcileStaleEvents(
      token.accessToken,
      runtime.calendarId,
      runtime.definition,
      options.dryRun ?? false
    );
    if (removedCount > 0) {
      console.log(`reconciled\t${removedCount}\tstale events`);
    }
  });
}

export function reconcileStaleEvents(
  token: string,
  calendarId: string,
  definition: LoadedCalendarDefinition,
  dryRun: boolean
) {
  return Effect.gen(function* () {
    const expectedIds = new Set(
      definition.events.map((e) => stableGoogleEventId(e.identityKey))
    );
    const activeSourceIds = new Set(definition.sources.map((s) => s.id));
    let removedCount = 0;

    for (const sourceId of activeSourceIds) {
      const gcalEvents = yield* listCalendarEvents(token, calendarId, {
        privateExtendedProperty: `source_id=${sourceId}`,
        singleEvents: "false",
        maxResults: "2500"
      });

      for (const gcalEvent of gcalEvents) {
        if (!gcalEvent.id) continue;
        if (gcalEvent.status === "cancelled") continue;
        const props = gcalEvent.extendedProperties?.private ?? {};
        if (props.source !== "linear-gsuite") continue;
        if (expectedIds.has(props.google_event_id || gcalEvent.id)) continue;

        if (dryRun) {
          console.log(`would-remove-stale\t${props.sync_id || gcalEvent.id}\t${gcalEvent.id}`);
          removedCount += 1;
          continue;
        }

        yield* deleteCalendarEvent(token, calendarId, gcalEvent.id);
        console.log(`removed-stale\t${props.sync_id || gcalEvent.id}\t${gcalEvent.id}`);
        removedCount += 1;
      }
    }

    return removedCount;
  });
}

export function resolveLaunchdLabel(configFile: string, cwd = process.cwd()) {
  return Effect.gen(function* () {
    const definition = yield* loadCalendarDefinition(configFile, cwd);
    return definition.agents?.["calendar-sync"]?.label || DEFAULT_CALENDAR_SYNC_LABEL;
  });
}
