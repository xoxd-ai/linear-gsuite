import { Effect } from "effect";
import { stableGoogleEventId } from "./google.js";
import { CliError, fail } from "./utils.js";

export interface CalendarReminder {
  method: "popup" | "email";
  minutes: number;
}

export interface ProviderEvent {
  calendarId: string;
  eventId: string;
  etag: string;
  iCalUID?: string;
  visibility?: string;
  reminders?: { useDefault?: boolean; overrides?: CalendarReminder[] };
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  eventType?: string;
  creator?: { email?: string; self?: boolean };
  organizer?: { email?: string; self?: boolean };
  attendees?: unknown[];
  attendeesOmitted?: boolean;
  recurrence?: string[];
  recurringEventId?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export interface CalendarMetadata {
  id: string;
  accessRole?: "none" | "freeBusyReader" | "reader" | "writer" | "writerWithoutPrivateAccess" | "owner";
  timeZone?: string;
  primary: boolean;
  hidden: boolean;
  selected: boolean;
  deleted: boolean;
}

export interface CalendarDiscovery {
  calendars: CalendarMetadata[];
  pages: number;
  complete: true;
}

export interface CalendarWindow {
  calendarId: string;
  timeMin: string;
  timeMax: string;
}

export interface PrivateEventInput {
  calendarId: string;
  idempotencyKey: string;
  summary: string;
  description?: string;
  reminders?: CalendarReminder[];
  start: string;
  end: string;
  timeZone: string;
}

export interface RescheduleInput {
  calendarId: string;
  eventId: string;
  etag: string;
  start: string;
  end: string;
  timeZone: string;
}

export class CalendarProviderError extends CliError {
  constructor(readonly code: "conflict" | "unknown-outcome" | "rejected" | "read-failed" | "not-found", message: string, readonly status?: number) {
    super(message);
  }
}

export interface GoogleCalendarProviderOptions {
  accessToken: () => Effect.Effect<string, CliError>;
  calendarIds: readonly string[];
  jessEmail: string;
  cadeCreatorEmails?: readonly string[];
  fetch?: typeof fetch;
}

const API = "https://www.googleapis.com/calendar/v3";
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 1000;

function validateWindow(start: string, end: string) {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(start) || !/(Z|[+-]\d{2}:\d{2})$/.test(end)) {
    throw fail("Calendar times require an explicit UTC offset");
  }
  const duration = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_WINDOW_MS) {
    throw fail("Calendar window must be positive and at most 31 days");
  }
}

function validateTimes(input: { start: string; end: string; timeZone: string }) {
  validateWindow(input.start, input.end);
  new Intl.DateTimeFormat("en", { timeZone: input.timeZone });
}

function reminderIdentity(reminders: readonly CalendarReminder[]) {
  if (!Array.isArray(reminders) || reminders.length > 5 || reminders.some(reminder => !reminder || !["popup", "email"].includes(reminder.method) || !Number.isInteger(reminder.minutes) || reminder.minutes < 0 || reminder.minutes > 40320)) {
    throw fail("Calendar reminders require at most 5 popup/email overrides with integer minutes from 0 to 40320");
  }
  return reminders.map(reminder => `${reminder.method}:${reminder.minutes}`).sort().join(",");
}

export function privateGoogleEventId(idempotencyKey: string) {
  return stableGoogleEventId(`cade:${idempotencyKey}`);
}

export function createGoogleCalendarProvider(options: GoogleCalendarProviderOptions) {
  const transport = options.fetch ?? fetch;
  const allowed = new Set(options.calendarIds);
  const jessEmail = options.jessEmail.trim().toLowerCase();
  const cadeCreators = new Set((options.cadeCreatorEmails ?? []).map(email => email.trim().toLowerCase()).filter(Boolean));

  function checked<A>(fn: () => A) {
    return Effect.try({ try: fn, catch: error => error instanceof CliError ? error : fail("Invalid calendar input") });
  }

  function eventPath(calendarId: string, eventId?: string) {
    if (!allowed.has(calendarId)) throw fail("Calendar is outside the configured allowlist");
    if (eventId === "") throw fail("Event identity is required");
    return `/calendars/${encodeURIComponent(calendarId)}/events${eventId === undefined ? "" : `/${encodeURIComponent(eventId)}`}`;
  }

  function request(method: string, path: string, body?: unknown, etag?: string) {
    return Effect.gen(function* () {
      const token = yield* options.accessToken();
      return yield* Effect.tryPromise({
        try: async () => {
          const write = method !== "GET" && path !== "/freeBusy";
          let response: Response;
          try {
            response = await transport(`${API}${path}`, {
              method,
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : {}) },
              body: body === undefined ? undefined : JSON.stringify(body),
              signal: AbortSignal.timeout(20_000)
            });
          } catch {
            throw new CalendarProviderError(write ? "unknown-outcome" : "read-failed", write ? "Calendar write outcome unknown; reconcile by event identity before retry" : "Calendar read failed");
          }
          if (!response.ok) {
            throw new CalendarProviderError(response.status === 404 ? "not-found" : response.status === 412 ? "conflict" : response.status === 409 ? "conflict" : write && response.status >= 500 ? "unknown-outcome" : "rejected", `Calendar request failed (${response.status})`, response.status);
          }
          try { return await response.json() as Record<string, unknown>; }
          catch { throw new CalendarProviderError(write ? "unknown-outcome" : "read-failed", "Calendar response unreadable; reconcile before retrying writes"); }
        },
        catch: error => error instanceof CliError ? error : fail("Calendar request failed")
      });
    });
  }

  function listCalendarMetadata(bounds: { maxPages?: number; maxCalendars?: number } = {}) {
    return Effect.gen(function* () {
      const limits = yield* checked(() => {
        const maxPages = bounds.maxPages ?? 128;
        const maxCalendars = bounds.maxCalendars ?? 10000;
        if (![maxPages, maxCalendars].every(value => Number.isSafeInteger(value) && value > 0)) throw fail("Invalid calendar discovery bounds");
        return { maxPages, maxCalendars };
      });
      const calendars: CalendarMetadata[] = [];
      const ids = new Set<string>();
      const tokens = new Set<string>();
      let pageToken: string | undefined;
      let pages = 0;
      do {
        if (pages >= limits.maxPages) return yield* Effect.fail(new CalendarProviderError("read-failed", "Calendar discovery incomplete: page bound exceeded"));
        const query = new URLSearchParams({ maxResults: "250", showHidden: "true", showDeleted: "true", fields: "items(id,accessRole,timeZone,primary,hidden,selected,deleted),nextPageToken" });
        if (pageToken) query.set("pageToken", pageToken);
        const raw = yield* request("GET", `/users/me/calendarList?${query}`);
        const page = yield* checked(() => {
          if (!Array.isArray(raw.items)) throw fail("Calendar discovery lacks an item list");
          const result: CalendarMetadata[] = [];
          for (const item of raw.items) {
            if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || item.id.length > 1024 || ids.has(item.id)) throw fail("Calendar discovery identity is missing or repeated");
            if ((item.deleted !== true || item.accessRole !== undefined) && !["none", "freeBusyReader", "reader", "writer", "writerWithoutPrivateAccess", "owner"].includes(item.accessRole)) throw fail("Calendar discovery access role is unresolved");
            for (const flag of ["primary", "hidden", "selected", "deleted"]) if (item[flag] !== undefined && typeof item[flag] !== "boolean") throw fail("Invalid calendar metadata flag");
            if (item.timeZone !== undefined) { if (typeof item.timeZone !== "string") throw fail("Invalid calendar timezone"); new Intl.DateTimeFormat("en", { timeZone: item.timeZone }); }
            ids.add(item.id);
            result.push({ id: item.id, ...(item.accessRole === undefined ? {} : { accessRole: item.accessRole }), ...(item.timeZone === undefined ? {} : { timeZone: item.timeZone }), primary: item.primary === true, hidden: item.hidden === true, selected: item.selected === true, deleted: item.deleted === true });
          }
          if (calendars.length + result.length > limits.maxCalendars) throw fail("Calendar discovery incomplete: calendar bound exceeded");
          if (raw.nextPageToken !== undefined && (typeof raw.nextPageToken !== "string" || !raw.nextPageToken || raw.nextPageToken.length > 8192 || tokens.has(raw.nextPageToken))) throw fail("Calendar discovery pagination is invalid or repeated");
          return { items: result, nextPageToken: raw.nextPageToken as string | undefined };
        });
        calendars.push(...page.items); pages++;
        pageToken = page.nextPageToken;
        if (pageToken) tokens.add(pageToken);
      } while (pageToken);
      return { calendars, pages, complete: true } satisfies CalendarDiscovery;
    });
  }

  function event(calendarId: string, raw: Record<string, unknown>) {
    if (typeof raw.id !== "string" || typeof raw.etag !== "string") throw fail("Calendar response lacks identity or revision");
    return { ...raw, calendarId, eventId: raw.id, etag: raw.etag } as ProviderEvent;
  }

  function get(calendarId: string, eventId: string) {
    return Effect.gen(function* () {
      const path = yield* checked(() => eventPath(calendarId, eventId));
      const raw = yield* request("GET", path);
      return yield* checked(() => event(calendarId, raw));
    });
  }

  function list(input: CalendarWindow) {
    return Effect.gen(function* () {
      const path = yield* checked(() => { validateWindow(input.timeMin, input.timeMax); return eventPath(input.calendarId); });
      const result: ProviderEvent[] = [];
      let pageToken: string | undefined;
      let pages = 0;
      do {
        if (++pages > 20) return yield* Effect.fail(fail("Calendar pagination limit exceeded; narrow the window"));
        const params = new URLSearchParams({ timeMin: input.timeMin, timeMax: input.timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
        if (pageToken) params.set("pageToken", pageToken);
        const raw = yield* request("GET", `${path}?${params}`);
        const items = yield* checked(() => {
          if (raw.items !== undefined && !Array.isArray(raw.items)) throw fail("Invalid calendar event list");
          return (raw.items ?? []) as Record<string, unknown>[];
        });
        for (const item of items) result.push(yield* checked(() => event(input.calendarId, item)));
        pageToken = typeof raw.nextPageToken === "string" ? raw.nextPageToken : undefined;
        if (result.length > MAX_EVENTS || pageToken && result.length >= MAX_EVENTS) return yield* Effect.fail(fail("Calendar result limit exceeded; narrow the window"));
      } while (pageToken);
      return result;
    });
  }

  function freeBusy(input: { calendarIds: readonly string[]; timeMin: string; timeMax: string }) {
    return Effect.gen(function* () {
      yield* checked(() => {
        validateWindow(input.timeMin, input.timeMax);
        if (!input.calendarIds.length || input.calendarIds.length > 50 || input.calendarIds.some(id => !allowed.has(id))) throw fail("Calendar is outside the configured allowlist");
      });
      const raw = yield* request("POST", "/freeBusy", { timeMin: input.timeMin, timeMax: input.timeMax, items: input.calendarIds.map(id => ({ id })) });
      return yield* checked(() => {
        const calendars = raw.calendars as Record<string, { busy?: unknown; errors?: unknown[] }> | undefined;
        for (const id of input.calendarIds) {
          if (!calendars?.[id] || calendars[id].errors?.length || !Array.isArray(calendars[id].busy)) throw fail("Calendar availability incomplete; do not infer free time");
        }
        return raw;
      });
    });
  }

  function createPrivate(input: PrivateEventInput) {
    return Effect.gen(function* () {
      const path = yield* checked(() => {
        validateTimes(input);
        if (input.reminders !== undefined) reminderIdentity(input.reminders);
        if (!input.idempotencyKey.trim() || !input.summary.trim()) throw fail("Event summary and idempotency key are required");
        return eventPath(input.calendarId);
      });
      const key = privateGoogleEventId(input.idempotencyKey);
      const resource = {
        id: key, visibility: "private", summary: input.summary, description: input.description ?? "",
        ...(input.reminders === undefined ? {} : { reminders: { useDefault: false, overrides: input.reminders } }),
        start: { dateTime: input.start, timeZone: input.timeZone }, end: { dateTime: input.end, timeZone: input.timeZone },
        extendedProperties: { private: { source: "cade", request_id: key } }
      };
      const write = request("POST", `${path}?sendUpdates=none`, resource);
      const raw = yield* Effect.catch(write, error => {
        if (!(error instanceof CalendarProviderError) || error.code !== "conflict") return Effect.fail(error);
        return request("GET", `${path}/${key}`);
      });
      return yield* checked(() => {
        const found = event(input.calendarId, raw);
        if (input.reminders !== undefined && (found.reminders?.useDefault !== false || reminderIdentity(found.reminders.overrides ?? []) !== reminderIdentity(input.reminders)) || found.status === "cancelled" || found.attendeesOmitted === true || found.attendees?.length || found.location?.trim() || found.recurrence?.length || found.recurringEventId || found.eventType && found.eventType !== "default" || found.start?.date || found.end?.date || found.start?.timeZone !== input.timeZone || found.end?.timeZone !== input.timeZone || found.eventId !== key || found.visibility !== "private" || found.extendedProperties?.private?.request_id !== key || found.extendedProperties?.private?.source !== "cade" || found.summary !== input.summary || (found.description ?? "") !== (input.description ?? "") || Date.parse(found.start?.dateTime ?? "") !== Date.parse(input.start) || Date.parse(found.end?.dateTime ?? "") !== Date.parse(input.end)) {
          throw new CalendarProviderError("conflict", "Existing event does not match the private idempotent request");
        }
        return found;
      });
    });
  }

  function reschedule(input: RescheduleInput) {
    return Effect.gen(function* () {
      yield* checked(() => { validateTimes(input); if (!input.etag) throw fail("Event revision is required"); });
      const current = yield* get(input.calendarId, input.eventId);
      yield* checked(() => {
        if (current.etag !== input.etag) throw new CalendarProviderError("conflict", "Calendar event changed; refresh before rescheduling");
        const source = current.extendedProperties?.private?.source;
        const creator = current.creator?.email?.toLowerCase();
        const organizer = current.organizer?.email?.toLowerCase();
        const ownedByJess = !!jessEmail && creator === jessEmail && organizer === jessEmail;
        const ownedByCade = !!creator && (creator === organizer || !!jessEmail && organizer === jessEmail) && cadeCreators.has(creator) && source === "cade" && current.extendedProperties?.private?.request_id === current.eventId;
        const owned = ownedByJess || ownedByCade;
        const originalDuration = Date.parse(current.end?.dateTime ?? "") - Date.parse(current.start?.dateTime ?? "");
        if (current.start?.date || current.end?.date || !Number.isFinite(originalDuration) || originalDuration <= 0 || originalDuration !== Date.parse(input.end) - Date.parse(input.start) || current.start?.timeZone !== input.timeZone || current.end?.timeZone !== input.timeZone) {
          throw new CalendarProviderError("rejected", "Event requires review: preserve timed-event duration and original explicit timezone");
        }
        if (!owned || current.visibility !== "private" || current.attendeesOmitted === true || current.attendees?.length || current.location?.trim() || current.recurrence?.length || current.recurringEventId || current.status === "cancelled" || current.eventType && current.eventType !== "default" || source && source !== "cade" || /\b(travel|flight|train|airport|drive|commute|appointment|in[- ]person)\b/i.test(`${current.summary ?? ""} ${current.description ?? ""}`)) {
          throw new CalendarProviderError("rejected", "Event requires review: only owned solo non-travel events without physical locations or recurrence can move automatically");
        }
      });
      const path = yield* checked(() => eventPath(input.calendarId, input.eventId));
      const raw = yield* request("PATCH", `${path}?sendUpdates=none`, { visibility: "private", start: { dateTime: input.start, timeZone: input.timeZone }, end: { dateTime: input.end, timeZone: input.timeZone } }, input.etag);
      return yield* checked(() => {
        const updated = event(input.calendarId, raw);
        if (updated.visibility !== "private" || updated.eventId !== input.eventId || Date.parse(updated.start?.dateTime ?? "") !== Date.parse(input.start) || Date.parse(updated.end?.dateTime ?? "") !== Date.parse(input.end)) throw new CalendarProviderError("unknown-outcome", "Calendar write requires private visibility readback");
        return updated;
      });
    });
  }

  return { get, list, freeBusy, createPrivate, reschedule, listCalendarMetadata };
}
