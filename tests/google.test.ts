import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reconcileStaleEvents, stableGoogleEventId, syncCalendar } from "../src/google.js";
import { createGoogleCalendarProvider } from "../src/calendar-provider.js";

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("google calendar sync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats 410 Gone duplicate deletes as already pruned", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-gsuite-google-"));
    const sourceFile = path.join(tempDir, "events.json");
    const configFile = path.join(tempDir, "linear-gsuite.package.json");
    const localConfigFile = path.join(tempDir, "config.json");
    const oauthClientFile = path.join(tempDir, "client.json");
    const oauthManagedFile = path.join(tempDir, "managed-client.json");
    const oauthTokenFile = path.join(tempDir, "token.json");

    writeJson(sourceFile, {
      timezone: "America/New_York",
      events: [
        {
          id: "ops-review",
          summary: "Ops review",
          description: "",
          start: "2026-05-01T13:00:00-04:00",
          end: "2026-05-01T13:30:00-04:00"
        }
      ]
    });
    writeJson(configFile, {
      name: "test-calendar",
      timezone: "America/New_York",
      sources: [
        {
          id: "ops",
          type: "json-recurring-events",
          path: "./events.json"
        }
      ]
    });
    writeJson(localConfigFile, {
      authMode: "user",
      calendarId: "primary",
      oauthClientManagedFile: oauthManagedFile,
      oauthTokenFile
    });
    writeJson(oauthClientFile, {
      installed: {
        client_id: "test-client",
        client_secret: "test-secret",
        redirect_uris: ["http://localhost"]
      }
    });
    writeJson(oauthTokenFile, {
      refresh_token: "refresh-token"
    });

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      const method = init?.method ?? "GET";

      if (urlText === "https://oauth2.googleapis.com/token") {
        return jsonResponse({
          access_token: "access-token",
          expires_in: 3600,
          token_type: "Bearer"
        });
      }

      const parsed = new URL(urlText);
      if (method === "GET" && parsed.pathname.includes("/events/")) {
        return jsonResponse({ id: parsed.pathname.split("/").at(-1) });
      }

      if (method === "PUT" && parsed.pathname.includes("/events/")) {
        return jsonResponse({ id: parsed.pathname.split("/").at(-1) });
      }

      if (method === "GET" && parsed.pathname.endsWith("/events")) {
        if (parsed.searchParams.get("privateExtendedProperty") === "sync_id=ops-review") {
          return jsonResponse({
            items: [
              {
                id: "already-deleted-duplicate"
              }
            ]
          });
        }
        return jsonResponse({ items: [] });
      }

      if (method === "DELETE" && parsed.pathname.endsWith("/events/already-deleted-duplicate")) {
        return jsonResponse({ error: { code: 410, message: "Gone" } }, 410);
      }

      throw new Error(`Unexpected request: ${method} ${urlText}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await Effect.runPromise(
      syncCalendar({
        configFile,
        localConfigFile,
        authMode: "user",
        oauthClientSecretsFile: oauthClientFile,
        oauthTokenFile,
        calendarId: "primary"
      }, tempDir)
    );

    const projectionWrite = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(projectionWrite?.[1]?.body as string).visibility).toBe("private");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/events/already-deleted-duplicate?sendUpdates=none"),
      expect.objectContaining({ method: "DELETE" })
    );
  });

  function setupTestDir() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-gsuite-reconcile-"));
    const sourceFile = path.join(tempDir, "events.json");
    const configFile = path.join(tempDir, "linear-gsuite.package.json");
    const localConfigFile = path.join(tempDir, "config.json");
    const oauthClientFile = path.join(tempDir, "client.json");
    const oauthTokenFile = path.join(tempDir, "token.json");

    writeJson(sourceFile, { timezone: "America/New_York", events: [] });
    writeJson(configFile, {
      name: "test-calendar",
      timezone: "America/New_York",
      sources: [{ id: "ops", type: "json-recurring-events", path: "./events.json" }]
    });
    writeJson(localConfigFile, { authMode: "user", calendarId: "primary", oauthTokenFile });
    writeJson(oauthClientFile, {
      installed: { client_id: "test-client", client_secret: "test-secret", redirect_uris: ["http://localhost"] }
    });
    writeJson(oauthTokenFile, { refresh_token: "refresh-token" });

    return { tempDir, configFile, localConfigFile, oauthClientFile, oauthTokenFile };
  }

  function syncOptions(t: ReturnType<typeof setupTestDir>, extra: Record<string, unknown> = {}) {
    return {
      configFile: t.configFile,
      localConfigFile: t.localConfigFile,
      authMode: "user" as const,
      oauthClientSecretsFile: t.oauthClientFile,
      oauthTokenFile: t.oauthTokenFile,
      calendarId: "primary",
      ...extra
    };
  }

  it("removes stale events for issues no longer in definition", async () => {
    const t = setupTestDir();
    const staleGcalId = "lgs-stale-event-from-completed-issue";
    const deletedIds: string[] = [];

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      const method = init?.method ?? "GET";
      const parsed = new URL(urlText);

      if (urlText === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "access-token", expires_in: 3600, token_type: "Bearer" });
      }
      if (method === "GET" && parsed.pathname.endsWith("/events")) {
        if (parsed.searchParams.get("privateExtendedProperty") === "source_id=ops") {
          return jsonResponse({
            items: [{
              id: staleGcalId,
              summary: "TIN-999 — Old completed issue",
              status: "confirmed",
              extendedProperties: {
                private: { source: "linear-gsuite", sync_id: "TIN-999", source_id: "ops", google_event_id: staleGcalId }
              }
            }]
          });
        }
        return jsonResponse({ items: [] });
      }
      if (method === "DELETE") {
        deletedIds.push(parsed.pathname.split("/").at(-1) || "");
        return jsonResponse({});
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await Effect.runPromise(syncCalendar(syncOptions(t), t.tempDir));
    expect(deletedIds).toContain(staleGcalId);
  });

  it("does not remove events from sources not in config", async () => {
    const t = setupTestDir();
    const deletedIds: string[] = [];

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      const method = init?.method ?? "GET";
      const parsed = new URL(urlText);

      if (urlText === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "access-token", expires_in: 3600, token_type: "Bearer" });
      }
      if (method === "GET" && parsed.pathname.endsWith("/events")) {
        const prop = parsed.searchParams.get("privateExtendedProperty") || "";
        if (prop === "source_id=ops") return jsonResponse({ items: [] });
        if (prop.startsWith("source_id=other")) {
          throw new Error("Should not query for sources not in config");
        }
        return jsonResponse({ items: [] });
      }
      if (method === "DELETE") {
        deletedIds.push(parsed.pathname.split("/").at(-1) || "");
        return jsonResponse({});
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await Effect.runPromise(syncCalendar(syncOptions(t), t.tempDir));
    expect(deletedIds).toHaveLength(0);
  });

  it("dry-run logs stale events without deleting", async () => {
    const t = setupTestDir();
    const staleGcalId = "lgs-stale-dry-run";
    const deletedIds: string[] = [];
    const logged: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logged.push(args.join("\t")); };

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      const method = init?.method ?? "GET";
      const parsed = new URL(urlText);

      if (urlText === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "access-token", expires_in: 3600, token_type: "Bearer" });
      }
      if (method === "GET" && parsed.pathname.endsWith("/events")) {
        if (parsed.searchParams.get("privateExtendedProperty") === "source_id=ops") {
          return jsonResponse({
            items: [{
              id: staleGcalId,
              status: "confirmed",
              extendedProperties: {
                private: { source: "linear-gsuite", sync_id: "TIN-DRY", source_id: "ops", google_event_id: staleGcalId }
              }
            }]
          });
        }
        return jsonResponse({ items: [] });
      }
      if (method === "DELETE") {
        deletedIds.push(parsed.pathname.split("/").at(-1) || "");
        return jsonResponse({});
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await Effect.runPromise(syncCalendar(syncOptions(t, { dryRun: true }), t.tempDir));
    console.log = origLog;

    expect(deletedIds).toHaveLength(0);
    expect(logged.some((l) => l.includes("would-remove-stale") && l.includes("TIN-DRY"))).toBe(true);
  });

  it("skips cancelled GCal tombstones during reconciliation", async () => {
    const t = setupTestDir();
    const deletedIds: string[] = [];

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      const method = init?.method ?? "GET";
      const parsed = new URL(urlText);

      if (urlText === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "access-token", expires_in: 3600, token_type: "Bearer" });
      }
      if (method === "GET" && parsed.pathname.endsWith("/events")) {
        if (parsed.searchParams.get("privateExtendedProperty") === "source_id=ops") {
          return jsonResponse({
            items: [{
              id: "lgs-tombstone",
              status: "cancelled",
              extendedProperties: {
                private: { source: "linear-gsuite", sync_id: "TIN-GHOST", source_id: "ops", google_event_id: "lgs-tombstone" }
              }
            }]
          });
        }
        return jsonResponse({ items: [] });
      }
      if (method === "DELETE") {
        deletedIds.push(parsed.pathname.split("/").at(-1) || "");
        return jsonResponse({});
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await Effect.runPromise(syncCalendar(syncOptions(t), t.tempDir));
    expect(deletedIds).toHaveLength(0);
  });

  it("handles pagination during reconciliation", async () => {
    const t = setupTestDir();
    const deletedIds: string[] = [];
    let listCallCount = 0;

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      const method = init?.method ?? "GET";
      const parsed = new URL(urlText);

      if (urlText === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "access-token", expires_in: 3600, token_type: "Bearer" });
      }
      if (method === "GET" && parsed.pathname.endsWith("/events")) {
        if (parsed.searchParams.get("privateExtendedProperty") === "source_id=ops") {
          listCallCount += 1;
          if (!parsed.searchParams.get("pageToken")) {
            return jsonResponse({ items: [], nextPageToken: "page2" });
          }
          if (parsed.searchParams.get("pageToken") === "page2") {
            return jsonResponse({
              items: [{
                id: "lgs-stale-page2",
                status: "confirmed",
                extendedProperties: {
                  private: { source: "linear-gsuite", sync_id: "TIN-PAGE2", source_id: "ops", google_event_id: "lgs-stale-page2" }
                }
              }]
            });
          }
        }
        return jsonResponse({ items: [] });
      }
      if (method === "DELETE") {
        deletedIds.push(parsed.pathname.split("/").at(-1) || "");
        return jsonResponse({});
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await Effect.runPromise(syncCalendar(syncOptions(t), t.tempDir));
    expect(listCallCount).toBeGreaterThanOrEqual(2);
    expect(deletedIds).toContain("lgs-stale-page2");
  });
});


describe("bounded assistant calendar provider", () => {
  const times = { start: "2026-10-25T10:00:00-04:00", end: "2026-10-25T10:30:00-04:00", timeZone: "America/New_York" };
  const input = { calendarId: "primary", idempotencyKey: "task-1", summary: "Answer Cade", ...times };
  function provider(fetchMock: ReturnType<typeof vi.fn>) {
    return createGoogleCalendarProvider({ accessToken: () => Effect.succeed("test-token"), calendarIds: ["primary"], jessEmail: "jess@example.test", cadeCreatorEmails: ["cade@example.test"], fetch: fetchMock });
  }
  function owned(extra: Record<string, unknown> = {}) {
    return { id: "event-1", etag: '"v1"', visibility: "private", creator: { email: "jess@example.test" }, organizer: { email: "jess@example.test" }, summary: "Focus", start: { dateTime: "2026-10-24T10:00:00-04:00", timeZone: "America/New_York" }, end: { dateTime: "2026-10-24T10:30:00-04:00", timeZone: "America/New_York" }, ...extra };
  }
  it("creates private events with stable identity and reconciles duplicate retries", async () => {
    let created: Record<string, unknown> = {};
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {
        if (Object.keys(created).length) return jsonResponse({}, 409);
        created = { ...JSON.parse(init.body as string), etag: '"v1"', iCalUID: "uid-1" };
      }
      return jsonResponse(created);
    });
    const api = provider(transport);
    const first = await Effect.runPromise(api.createPrivate(input));
    const second = await Effect.runPromise(api.createPrivate(input));
    expect(first.eventId).toBe(stableGoogleEventId("cade:task-1"));
    expect(second).toEqual(first);
    expect(first.visibility).toBe("private");
    expect(first.iCalUID).toBe("uid-1");
    await expect(Effect.runPromise(api.createPrivate({ ...input, summary: "Different task" }))).rejects.toThrow("does not match");
  });
  it.each([
    { status: "cancelled" },
    { attendees: [{ email: "other@example.test" }] },
    { eventType: "outOfOffice" },
    { start: { dateTime: times.start, timeZone: "US/Eastern" } }
  ])("rejects a tombstoned or changed idempotent event %j", async extra => {
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "POST" ? jsonResponse({}, 409) : jsonResponse({ id: stableGoogleEventId("cade:task-1"), etag: '"v1"', visibility: "private", summary: input.summary, description: "", start: { dateTime: times.start, timeZone: times.timeZone }, end: { dateTime: times.end, timeZone: times.timeZone }, extendedProperties: { private: { source: "cade", request_id: stableGoogleEventId("cade:task-1") } }, ...extra }));
    await expect(Effect.runPromise(provider(transport).createPrivate(input))).rejects.toThrow("does not match");
  });
  it.each([
    { start: { date: "2026-10-24" }, end: { date: "2026-10-25" } },
    { end: { dateTime: "2026-10-24T11:00:00-04:00", timeZone: "America/New_York" } },
    { start: { dateTime: "2026-10-24T10:00:00-04:00" } },
    { start: { dateTime: "2026-10-24T10:00:00-04:00", timeZone: "America/Detroit" } }
  ])("preserves all-day type, original duration and timezone %j", async extra => {
    const transport = vi.fn(async () => jsonResponse(owned(extra)));
    await expect(Effect.runPromise(provider(transport).reschedule({ calendarId: "primary", eventId: "event-1", etag: '"v1"', ...times }))).rejects.toThrow("preserve timed-event duration");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(["cade@example.test", "jess@example.test"])("permits an explicit Cade creator only with matching ownership metadata and organizer %s", async organizer => {
    const ownership = { creator: { email: "cade@example.test" }, organizer: { email: organizer }, extendedProperties: { private: { source: "cade", request_id: "event-1" } } };
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => jsonResponse(init?.method === "PATCH" ? owned({ ...ownership, ...JSON.parse(init.body as string), etag: '"v2"' }) : owned(ownership)));
    expect((await Effect.runPromise(provider(transport).reschedule({ calendarId: "primary", eventId: "event-1", etag: '"v1"', ...times }))).etag).toBe('"v2"');
    const foreign = vi.fn(async () => jsonResponse(owned({ ...ownership, extendedProperties: { private: { source: "cade", request_id: "other-event" } } })));
    await expect(Effect.runPromise(provider(foreign).reschedule({ calendarId: "primary", eventId: "event-1", etag: '"v1"', ...times }))).rejects.toThrow("requires review");
    expect(foreign).toHaveBeenCalledTimes(1);
  });
  it("preserves event identity and guards updates with If-Match", async () => {
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => jsonResponse(init?.method === "PATCH" ? owned({ ...JSON.parse(init.body as string), etag: '"v2"' }) : owned()));
    const result = await Effect.runPromise(provider(transport).reschedule({ calendarId: "primary", eventId: "event-1", etag: '"v1"', ...times }));
    expect(result.etag).toBe('"v2"');
    const [, init] = transport.mock.calls[1]!;
    expect(init?.method).toBe("PATCH");
    expect(init?.headers).toMatchObject({ "If-Match": '"v1"' });
    expect(JSON.parse(init?.body as string)).not.toHaveProperty("summary");
  });
  it.each([
    { attendees: [{ email: "other@example.test" }] },
    { location: "Studio" },
    { summary: "Flight to Boston" },
    { recurrence: ["RRULE:FREQ=WEEKLY"] },
    { recurringEventId: "series" },
    { creator: { email: "other@example.test" } },
    { organizer: { email: "other@example.test" } },
    { extendedProperties: { private: { source: "linear-gsuite" } } }
  ])("does not move protected events %j", async extra => {
    const transport = vi.fn(async () => jsonResponse(owned(extra)));
    await expect(Effect.runPromise(provider(transport).reschedule({ calendarId: "primary", eventId: "event-1", etag: '"v1"', ...times }))).rejects.toThrow("requires review");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("does not overwrite a concurrent modification", async () => {
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => jsonResponse(init?.method === "PATCH" ? {} : owned(), init?.method === "PATCH" ? 412 : 200));
    await expect(Effect.runPromise(provider(transport).reschedule({ calendarId: "primary", eventId: "event-1", etag: '"v1"', ...times }))).rejects.toThrow("412");
    const stale = vi.fn(async () => jsonResponse(owned({ etag: '"v2"' })));
    await expect(Effect.runPromise(provider(stale).reschedule({ calendarId: "primary", eventId: "event-1", etag: '"v1"', ...times }))).rejects.toThrow("changed");
    expect(stale).toHaveBeenCalledTimes(1);
  });
  it("exposes unknown outcomes without automatically replaying writes", async () => {
    const transport = vi.fn(async () => { throw new Error("network failure"); });
    await expect(Effect.runPromise(provider(transport).createPrivate(input))).rejects.toThrow("outcome unknown");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("does not interpret incomplete freebusy results as free time", async () => {
    const window = { calendarIds: ["primary"], timeMin: times.start, timeMax: times.end };
    const transport = vi.fn(async () => jsonResponse({ calendars: { primary: { errors: [{ reason: "notFound" }] } } }));
    await expect(Effect.runPromise(provider(transport).freeBusy(window))).rejects.toThrow("do not infer free time");
    transport.mockImplementation(async () => jsonResponse({ calendars: { primary: { busy: [] } } }));
    expect(await Effect.runPromise(provider(transport).freeBusy(window))).toEqual({ calendars: { primary: { busy: [] } } });
  });
  it("bounds reads, checks calendar allowlists, and paginates", async () => {
    const transport = vi.fn(async () => jsonResponse(transport.mock.calls.length === 1 ? { items: [owned()], nextPageToken: "next" } : { items: [owned({ id: "event-2" })] }));
    const api = provider(transport);
    const window = { calendarId: "primary", timeMin: times.start, timeMax: times.end };
    expect(await Effect.runPromise(api.list(window))).toHaveLength(2);
    expect(String(transport.mock.calls[1]?.[0])).toContain("pageToken=next");
    await expect(Effect.runPromise(api.list({ ...window, calendarId: "unknown" }))).rejects.toThrow("allowlist");
    await expect(Effect.runPromise(api.list({ ...window, timeMax: "2027-01-01T00:00:00Z" }))).rejects.toThrow("31 days");
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
