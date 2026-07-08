import type { ProviderAdapter, RawCredentials, ToolTemplate } from "./types.js";
import type { EncryptedBlob } from "../../security/crypto.service.js";

const API_BASE = "https://api.cal.com/v2";

export class CalcomAdapter implements ProviderAdapter {
  readonly provider = "calcom";

  // Cal.com requires a company email to register an OAuth app. Use API key
  // auth instead — personal access keys are available at
  // app.cal.com/settings/developer/api-keys with no company email required.
  buildAuthUrl(_orgId: string, _state: string): null {
    return null;
  }

  async exchangeCode(_code: string, _orgId: string): Promise<RawCredentials> {
    throw new Error("Cal.com uses API key auth, not OAuth.");
  }

  async refreshTokens(_blob: EncryptedBlob): Promise<RawCredentials | null> {
    return null; // API keys don't expire
  }

  // Confirm the API key works by listing event types (a cheap authed GET).
  async verifyCredentials(credentials: RawCredentials): Promise<{ ok: boolean; error?: string }> {
    const apiKey = credentials.apiKey ?? "";
    if (!apiKey) return { ok: false, error: "No API key provided." };
    try {
      const res = await fetch("https://api.cal.com/v2/event-types", {
        headers: { Authorization: `Bearer ${apiKey}`, "cal-api-version": "2024-06-14" },
      });
      if (res.ok) return { ok: true };
      if (res.status === 401 || res.status === 403) return { ok: false, error: "Cal.com rejected this API key (unauthorized)." };
      return { ok: false, error: `Cal.com returned HTTP ${res.status}.` };
    } catch (err) {
      return { ok: false, error: `Couldn't reach Cal.com: ${(err as Error).message}` };
    }
  }

  getTools(): ToolTemplate[] {
    return [
      {
        key: "list_event_types",
        displayName: "List Meeting Types",
        description:
          "Lists the operator's bookable Cal.com meeting types (each has an id, title and duration). " +
          "Call this FIRST to discover the eventTypeId before listing slots or booking.",
        jsonSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        key: "list_calendar_slots",
        displayName: "List Available Calendar Slots",
        description:
          "Returns available meeting slots from the operator's Cal.com calendar for a given event type and date range. " +
          "Get the eventTypeId from list_event_types first.",
        jsonSchema: {
          type: "object",
          properties: {
            eventTypeId: { type: "string", description: "Cal.com event type ID (from list_event_types)" },
            startDate: { type: "string", format: "date", description: "Start of search range (YYYY-MM-DD)" },
            endDate: { type: "string", format: "date", description: "End of search range (YYYY-MM-DD)" },
          },
          required: ["eventTypeId", "startDate", "endDate"],
        },
      },
      {
        key: "book_meeting",
        displayName: "Book a Meeting",
        description:
          "Books a meeting slot in the operator's Cal.com calendar. Use a startTime returned by list_calendar_slots.",
        jsonSchema: {
          type: "object",
          properties: {
            eventTypeId: { type: "string", description: "Cal.com event type ID (from list_event_types)" },
            startTime: { type: "string", format: "date-time", description: "ISO 8601 start time of the chosen slot" },
            name: { type: "string", description: "Attendee full name" },
            email: {
              type: "string",
              description: "Attendee email. Optional — leave blank and the system uses the visitor's verified account email automatically (it may appear masked as [EMAIL] in the chat; that's expected).",
            },
            notes: { type: "string" },
          },
          required: ["eventTypeId", "startTime", "name"],
        },
      },
    ];
  }

  async execute(
    toolKey: string,
    args: Record<string, unknown>,
    credentials: RawCredentials,
    _sandbox: boolean,
  ): Promise<unknown> {
    const base = API_BASE;
    const token = credentials.apiKey ?? credentials.accessToken ?? "";
    // Cal.com pins behaviour to a date-stamped API version per endpoint. Bookings
    // require 2024-08-13; slots/event-types use 2024-09-04. Sending the wrong
    // version (or omitting it) yields 400s or empty results.
    const baseHeaders = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    // Cal.com error/success envelopes look like { status, data } or { error }.
    // Throw on non-2xx so the dispatcher logs status="error" and the AI doesn't
    // claim a booking succeeded when it didn't.
    const parse = async (res: Response, action: string): Promise<unknown> => {
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || json.status === "error") {
        const err = json.error as { message?: string } | undefined;
        const detail = err?.message || (json.message as string) || `HTTP ${res.status}`;
        throw new Error(`Cal.com ${action} failed: ${detail}`);
      }
      return json.data ?? json;
    };

    const fetchEventTypes = async (): Promise<Array<Record<string, unknown>>> => {
      const res = await fetch(`${base}/event-types`, {
        headers: { ...baseHeaders, "cal-api-version": "2024-06-14" },
      });
      const data = (await parse(res, "list event types")) as Array<Record<string, unknown>>;
      return Array.isArray(data) ? data : [];
    };

    // Resolve whatever the LLM passed as an event type into a REAL numeric id.
    // The model frequently passes the wrong thing — a slug ("15min"), a title, the
    // duration ("15"), or a positional index ("1") — so we can't trust a bare
    // number: we ALWAYS validate against the account's actual event types. Match
    // by real id → slug/title → duration; only then fall back to the first type.
    // Returns the matched event-type object so callers can read its booking fields.
    const resolveEventType = async (raw: unknown): Promise<Record<string, unknown>> => {
      const list = await fetchEventTypes();
      if (list.length === 0) throw new Error("No Cal.com event types are configured.");
      const key = String(raw ?? "").toLowerCase().trim();
      const byId = list.find((t) => String(t.id) === key);
      const byText =
        byId ??
        list.find((t) => {
          const title = String(t.title ?? "").toLowerCase();
          return (
            String(t.slug ?? "").toLowerCase() === key ||
            title === key ||
            title.replace(/\s+/g, "-") === key
          );
        });
      const byDuration =
        byText ?? (/^\d+$/.test(key) ? list.find((t) => String(t.lengthInMinutes) === key) : undefined);
      return byDuration ?? list[0]!;
    };
    const resolveEventTypeId = async (raw: unknown): Promise<number> =>
      Number((await resolveEventType(raw)).id);

    if (toolKey === "list_event_types") {
      // The /v2/event-types listing is pinned to the 2024-06-14 version; later
      // version stamps 404 on this path.
      const res = await fetch(`${base}/event-types`, {
        headers: { ...baseHeaders, "cal-api-version": "2024-06-14" },
      });
      const data = (await parse(res, "list event types")) as Array<Record<string, unknown>>;
      // Trim to the fields the AI needs so the tool result stays small.
      const types = (Array.isArray(data) ? data : []).map((t) => ({
        eventTypeId: String(t.id),
        title: t.title,
        durationMinutes: t.lengthInMinutes,
        slug: t.slug,
      }));
      return { eventTypes: types };
    }

    if (toolKey === "list_calendar_slots") {
      // v2 slots (version 2024-09-04) takes `start`/`end` as ISO 8601 datetimes.
      const start = `${String(args.startDate)}T00:00:00Z`;
      const end = `${String(args.endDate)}T23:59:59Z`;
      const timeZone = String(args.timeZone ?? "").trim() || "UTC";
      const eventTypeId = await resolveEventTypeId(args.eventTypeId);
      const qs = new URLSearchParams({
        eventTypeId: String(eventTypeId),
        start,
        end,
        timeZone,
      });
      const res = await fetch(`${base}/slots?${qs.toString()}`, {
        headers: { ...baseHeaders, "cal-api-version": "2024-09-04" },
      });
      // Response shape: { data: { "YYYY-MM-DD": [{ start: ISO }, ...], ... } }
      const data = (await parse(res, "list slots")) as Record<string, { start: string }[]>;
      const slots = Object.values(data ?? {})
        .flat()
        .map((s) => s.start)
        .filter(Boolean);
      // Return the RESOLVED numeric id so the slot cards can carry it into
      // book_meeting — the model otherwise re-guesses the id (and gets it wrong) —
      // plus the timezone so cards render in the visitor's local time.
      return { slots, eventTypeId: String(eventTypeId), timeZone };
    }

    if (toolKey === "book_meeting") {
      const eventType = await resolveEventType(args.eventTypeId);
      const eventTypeId = Number(eventType.id);

      // Satisfy any REQUIRED custom booking fields the event type defines (e.g. a
      // required "notes"/"Additional notes" field). Without this, Cal.com rejects
      // the booking with `responses - {slug}error_required_field`. name/email are
      // sent as the attendee; system fields are skipped. Text fields default to a
      // short note; anything else to "N/A" — enough to satisfy the requirement.
      const bookingFieldsResponses: Record<string, string> = {};
      const SYSTEM_FIELDS = new Set(["name", "email", "location", "guests", "rescheduleReason", "attendeePhoneNumber"]);
      const fields = (eventType.bookingFields as Array<Record<string, unknown>> | undefined) ?? [];
      for (const f of fields) {
        const slug = String(f.slug ?? f.name ?? "");
        if (!slug || f.required !== true || f.hidden === true || SYSTEM_FIELDS.has(slug)) continue;
        bookingFieldsResponses[slug] = String(f.type).includes("text") ? "Booked via support chat" : "N/A";
      }
      // Always honour an explicit note from the customer, if given.
      if (args.notes) bookingFieldsResponses.notes = String(args.notes);

      // The meeting is between the operator (host / Cal.com account owner) and the
      // visitor — Cal.com adds the host automatically, so we only send the visitor
      // as the attendee.
      const timeZone = String(args.timeZone ?? "").trim() || "UTC";
      // When the "require a real attendee name" guardrail is OFF, a booking can
      // reach here without a name (the guardrail would otherwise block it). Cal.com
      // rejects a blank attendee name, so fall back to a generic "Customer".
      const attendeeName = String(args.name ?? "").trim() || "Customer";
      const res = await fetch(`${base}/bookings`, {
        method: "POST",
        headers: { ...baseHeaders, "cal-api-version": "2024-08-13" },
        body: JSON.stringify({
          eventTypeId,
          start: args.startTime,
          attendee: { name: attendeeName, email: args.email, timeZone, language: "en" },
          ...(Object.keys(bookingFieldsResponses).length > 0 ? { bookingFieldsResponses } : {}),
        }),
      });
      const data = (await parse(res, "book meeting")) as Record<string, unknown>;
      return {
        ok: true,
        bookingUid: data.uid,
        start: data.start,
        meetingUrl: data.meetingUrl ?? data.location,
        timeZone,
      };
    }

    throw new Error(`Unknown tool key: ${toolKey}`);
  }
}
