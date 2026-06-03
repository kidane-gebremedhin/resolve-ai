# 28 — Visitor Phone Country-Code from IP

## Overview

Backlog item #8: "decide the phone country code from the user's IP and set it as the default country code in phone input fields." Plan: [`__plans/11-kb-crawl-and-phone.md`](../__plans/11-kb-crawl-and-phone.md) (shared with [`27-website-kb-crawl-favicon.md`](./27-website-kb-crawl-favicon.md)).

## Current state

| Piece | Status | Evidence |
|---|---|---|
| Widget phone inputs | ✅ raw | `PreChatScreen.tsx`, `ContactPromptScreen.tsx` — `<input type="tel">`, no country selector |
| Phone libs | ❌ none | widget `package.json` has no phone/intl-tel lib |
| IP capture | ✅ | `widget.routes.ts` stores `req.ip` on `ContactSession`; `trust proxy` set |
| Geo lookup | ❌ none | no geoip/maxmind/ipinfo anywhere |
| Init response | — | `InitResponse` has no `countryCode` |

## Design

### Server: IP → country
- Add an **offline** geo-IP lookup (`geoip-lite` — bundled DB, no external request, no per-lookup latency/cost) in the API.
- Resolve `req.ip` → ISO country code at widget bootstrap. Surface it to the widget via the **existing** `POST /widget/init` response (add `countryCode?: string`) — no extra round-trip. (A separate lightweight `GET /widget/geo` is an alternative if we want country before/without a session; default: piggyback on `init`.)
- Map ISO country → dialing code + flag in a small static table on the **widget** side (no need to ship a dialing-code DB on the server).

### Widget: country-code selector
- Use a proper phone-input component with a country dropdown (flag + `+NN`) preceding/within the phone field in both `PreChatScreen` and `ContactPromptScreen`. **Dependencies are allowed** (per latest direction) — prefer a maintained, lightweight library.
- Default selection = `countryCode` from `init` (fallback to a sensible default, e.g., `US/+1`, when geo is unknown).
- Store the dialing code + national number as an E.164 value (`+<code><number>`) in the contact payload (`updateContact` / pre-chat submit). The visitor can override the auto-selected country.

### Decisions
- **`geoip-lite`** (offline) on the server for IP→country — privacy-friendly, zero latency, no key. Accept the bundled-DB staleness tradeoff; document a periodic DB update.
- Piggyback country on `/widget/init` (no new endpoint) to avoid an extra request on load.
- **Widget phone input: use a dependency.** Default to **`react-phone-number-input`** (built on `libphonenumber-js`) — it provides the country dropdown, flags, the `defaultCountry` prop (fed from the geo `countryCode`), and E.164 output + validation in one package. Mind bundle size but correctness/UX wins here. (Alternative: `intl-tel-input`.)
- Country code is a **default, fully overridable** by the visitor; never blocks submission (phone stays optional).

### Open questions
- O1: Use the same widget country selector in dashboard phone fields (registration/leads)? → Default: **widget only** for this item; dashboard is a separate follow-up.

## Files
- `apps/api/package.json` — add `geoip-lite`.
- `apps/api/src/routes/widget.routes.ts` — resolve country from `req.ip`; add `countryCode` to init payload.
- `apps/widget/package.json` — add `react-phone-number-input` (pulls `libphonenumber-js`).
- `apps/widget/src/lib/api-client.ts` — `InitResponse.countryCode`.
- `apps/widget/src/components/PreChatScreen.tsx`, `ContactPromptScreen.tsx` — phone-input component with `defaultCountry`.
- `apps/widget/src/components/WidgetRoot.tsx` — thread `countryCode` to the screens.

## Out of scope
- Country-code defaults in dashboard (non-widget) phone fields.
- Timezone/locale detection beyond country.

## Acceptance
- [ ] On widget load from an IP that geo-resolves, the phone field's country selector defaults to that country's dialing code; unknown IP falls back to the default.
- [ ] Visitor can change the country; submitting stores the combined `+<code><number>`; phone remains optional.
- [ ] No external network call for geo (offline DB); no measurable init latency regression.
- [ ] `pnpm build` + `type-check` + `test` green.
