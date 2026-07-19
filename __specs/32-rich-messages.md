# 32 — Rich Messages: Tier 3

> **Status**: COMPLETE — implemented in Phase 16. See `CHANGELOG_8.md` and `__plans/16-rich-messages.md`.
> **Depends on**: spec 29 (Markdown render in place), spec 30 § 2A.5 (dispatcher for form tool args)
> **Blocks**: spec 31 § 2B.1 calendar slot card (now unblocked — card type shipped)
> **Implementation plan**: [`__plans/16-rich-messages.md`](../__plans/16-rich-messages.md)

## Implementation Notes

### Message blocks (3.0)
`blocks?: MessageBlock[]` added to `Message` schema as `Schema.Types.Mixed` array. Block types defined in `apps/api/src/types/messageBlocks.ts`. Widget renders `<BlockRenderer>` after AI message content when `m.blocks?.length > 0`.

### Card / carousel (3.1)
`resultToBlocks(toolKey, result)` in `dispatcher.ts` converts `list_calendar_slots` → `CarouselBlock` (up to 5 slot cards with "Book this slot" buttons) and `get_subscription` → `CardBlock`. Called after each successful integration tool dispatch in `agent.service.ts`.

> **Slot-booking bubble (Changelog 4).** A "Book this slot" button sends a precise,
> machine-oriented instruction (`"Please book the slot at <ISO> for event type <id>"`) so
> the AI books the exact slot. The widget MUST NOT show that raw string — `MessageList`'s
> `humanizeCustomerContent` renders that customer bubble as a friendly confirmation
> (e.g. "📅 Booking Wed, Jul 8, 09:30 AM"), matched by the stable generated shape so it
> also applies to the persisted message on reload. The value sent to the AI is unchanged.

### Inline forms (3.2)
`FormBlockRenderer` submits `{ content, formPayload, toolKey }` to `POST /widget/conversations/:id/messages`. Route handler validates `formPayload` against `ToolDefinition.jsonSchema` (ajv), dispatches via `dispatchToolCall`, then the AI generates an acknowledgement reply.

> **Field datatypes (Changelog 4).** `buildFormBlock` derives each `FormField`'s type +
> constraints from the tool's input JSON schema so the form enforces datatypes
> client-side: `number`/`integer` → number input (`step`, `min`, `max`; integers reject
> decimals); `boolean` → Yes/No select; `enum` → select; string `pattern` → validated.
> `FormBlockRenderer` validates type/integer/min/max/pattern before submit and drops
> empty optional values. This complements the server-side ajv coercion — the customer
> can't enter a value the schema would reject (e.g. "5" or "abc" in a numeric field).

### Image vision (3.3)
`generateAiReply` accepts `currentAttachments?: CurrentAttachment[]`. For `image/*` attachments: `getAttachmentBuffer` reads from storage, `sharp` resizes if over `AI_VISION_MAX_IMAGE_BYTES` (default 4 MB), encoded as base64 data URL and passed as `{ type: "image_url", image_url: { url, detail: "auto" } }` in the user content array. Falls back gracefully if sharp unavailable.

### OG link previews (3.4)
`apps/api/src/services/og/preview.service.ts` — `fetchOgPreview` calls `assertSafeUrl` (SSRF guard), fetches HTML, parses `<meta og:*>` with `node-html-parser`, caches in LRU (500 entries, 24h TTL). Called after the final reply in `agent.service.ts`; `LinkPreviewBlock`s appended to `accumulatedBlocks`. SSRF-blocked URLs silently return null.

---

## Overview

Plain text is a 2019 product. Tier 3 adds structured message content: cards,
carousels, inline forms, image vision understanding, and link previews.

The **shared prerequisite** for the whole tier is a structured `Message.blocks`
field. All four features are variations of the same block-renderer pattern.

Build order:
1. **3.0 Message blocks system** (prerequisite — schema + renderer registry)
2. **3.1 Card / carousel** (pricing cards, slot cards for calendar booking)
3. **3.2 Inline forms** (collects structured input → dispatches to a tool)
4. **3.3 Image vision** (AI reads uploaded images)
5. **3.4 Link previews** (Open Graph card for URLs in AI replies)

---

## 3.0 — Message blocks system (shared prerequisite)

### Problem
`Message.content` is a `string`. Rich content (cards, forms, carousels) cannot
be expressed in plain text.

### Design

**Model change — `apps/api/src/models/Message.ts`**

Add optional parallel field:
```typescript
blocks?: MessageBlock[];
```

`content` stays — it is the plain-text fallback for backward compatibility and
operator inbox display. When `blocks` is present, the widget renders blocks
instead of `content`. The operator inbox always uses `content` (no rich blocks
in the operator inbox view for now).

**Block type union**

`apps/api/src/types/messageBlocks.ts` (new shared types file):
```typescript
export type MessageBlock =
  | CardBlock
  | CarouselBlock
  | FormBlock
  | LinkPreviewBlock;

export interface CardBlock {
  type: "card";
  imageUrl?: string;
  title: string;
  subtitle?: string;
  badge?: string;          // e.g. "Most popular"
  price?: string;          // e.g. "$29/mo"
  buttons: CardButton[];
}

export interface CardButton {
  label: string;
  action: "send_message" | "open_url" | "submit_form";
  value: string;           // message text | URL | form field value
  variant?: "primary" | "secondary";
}

export interface CarouselBlock {
  type: "carousel";
  cards: CardBlock[];
}

export interface FormBlock {
  type: "form";
  title?: string;
  fields: FormField[];
  submitLabel: string;
  toolKey: string;         // dispatched to this integration tool on submit
}

export interface FormField {
  key: string;
  label: string;
  type: "text" | "email" | "tel" | "select" | "textarea";
  placeholder?: string;
  required?: boolean;
  options?: { label: string; value: string }[];  // for "select"
}

export interface LinkPreviewBlock {
  type: "link_preview";
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  favicon?: string;
}
```

**Renderer registry — `apps/widget/src/components/blocks/`**

```
apps/widget/src/components/blocks/
├── BlockRenderer.tsx        ← dispatches to the right renderer by block.type
├── CardBlock.tsx
├── CarouselBlock.tsx
├── FormBlock.tsx
└── LinkPreviewBlock.tsx
```

`BlockRenderer.tsx`:
```tsx
export function BlockRenderer({ blocks }: { blocks: MessageBlock[] }) {
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "card":        return <CardBlockRenderer key={i} block={block} />;
          case "carousel":    return <CarouselBlockRenderer key={i} block={block} />;
          case "form":        return <FormBlockRenderer key={i} block={block} />;
          case "link_preview":return <LinkPreviewBlockRenderer key={i} block={block} />;
          default:            return null;
        }
      })}
    </div>
  );
}
```

In `MessageList.tsx`, replace the content section for AI messages:
```tsx
{message.blocks?.length ? (
  <BlockRenderer blocks={message.blocks} />
) : (
  <ReactMarkdown ...>{message.content}</ReactMarkdown>
)}
```

**AI output → blocks**

The AI does not generate block JSON directly. Instead, the **tool dispatcher**
(spec 30 § 2A.5) converts tool results into blocks before persisting the Message:

```typescript
// In the tool dispatcher post-processing step:
function resultToBlocks(toolKey: string, result: object): MessageBlock[] | null {
  if (toolKey === "list_calendar_slots") return buildSlotCarousel(result);
  if (toolKey === "get_subscription") return buildSubscriptionCard(result);
  // ... etc.
  return null;
}
```

When `resultToBlocks()` returns blocks, the AI message is persisted with both
`content` (the AI's prose) and `blocks` (the structured UI), and `blocks`
takes precedence in the widget renderer.

---

## 3.1 — Card / carousel

### Card block UI — `apps/widget/src/components/blocks/CardBlock.tsx`

```tsx
export function CardBlockRenderer({ block }: { block: CardBlock }) {
  const { onSendMessage, onOpenUrl } = useWidgetContext();
  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden w-full max-w-xs">
      {block.imageUrl && (
        <img src={block.imageUrl} alt={block.title} className="w-full h-32 object-cover" />
      )}
      <div className="p-3">
        {block.badge && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{block.badge}</span>}
        <h3 className="font-semibold text-sm mt-1">{block.title}</h3>
        {block.subtitle && <p className="text-xs text-muted-foreground">{block.subtitle}</p>}
        {block.price && <p className="text-lg font-bold mt-1">{block.price}</p>}
        <div className="flex gap-2 mt-3 flex-wrap">
          {block.buttons.map((btn, i) => (
            <button
              key={i}
              className={btn.variant === "primary" ? "btn-primary text-xs" : "btn-outline text-xs"}
              onClick={() => {
                if (btn.action === "send_message") onSendMessage(btn.value);
                if (btn.action === "open_url") onOpenUrl(btn.value);
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

### Carousel block UI — `apps/widget/src/components/blocks/CarouselBlock.tsx`

Horizontal scroll container of `CardBlockRenderer` instances.
CSS: `flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2`.
Each card: `snap-start flex-shrink-0 w-[240px]`.

### Pricing card example
When the AI discusses pricing, the system prompt can instruct it to signal a
"show_pricing_card" quick-reply (spec 29 § 1.6), and the dispatcher intercepts
this to build a `CarouselBlock` of pricing `CardBlock`s from the org's Paddle
plan configuration.

### Calendar slot card example
`list_calendar_slots` result → `CarouselBlock` of slot `CardBlock`s:
```typescript
function buildSlotCarousel(slots: CalendarSlot[]): MessageBlock[] {
  return [{
    type: "carousel",
    cards: slots.slice(0, 5).map(slot => ({
      type: "card",
      title: formatDate(slot.startTime),
      subtitle: `${formatTime(slot.startTime)} – ${formatTime(slot.endTime)}`,
      buttons: [{
        label: "Book this slot",
        action: "send_message",
        value: `Book ${slot.startTime}`,
        variant: "primary",
      }],
    })),
  }];
}
```

---

## 3.2 — Inline forms

### Problem
Multi-field data collection (name + order number + reason) currently requires
multiple back-and-forth chat turns. A single form card collects all fields at once.

### Design

**AI emits a `FormBlock`** — either via a quick-reply trigger or when the AI
calls a tool that needs more structured input before it can proceed.

Example: `create_support_ticket` triggers a form:
```json
{
  "type": "form",
  "title": "Tell us more about your issue",
  "fields": [
    { "key": "title", "label": "Issue title", "type": "text", "required": true },
    { "key": "orderId", "label": "Order number", "type": "text", "placeholder": "e.g. ORD-1234" },
    { "key": "priority", "label": "Urgency", "type": "select", "options": [
      { "label": "Not urgent", "value": "low" },
      { "label": "Important", "value": "medium" },
      { "label": "Urgent", "value": "high" }
    ]}
  ],
  "submitLabel": "Submit",
  "toolKey": "create_support_ticket"
}
```

**Form renderer — `apps/widget/src/components/blocks/FormBlock.tsx`**

Renders fields using Tailwind + native `<input>`/`<select>`/`<textarea>`. On
submit:
1. Validate required fields client-side.
2. POST to `POST /widget/conversations/:id/messages` with:
   ```json
   { "content": "[form submission]", "formPayload": { ...fields }, "toolKey": "create_support_ticket" }
   ```
3. Replace the form card with a "Submitted!" confirmation block.

**API — form payload handling**

In `apps/api/src/routes/widget.routes.ts`, the `sendMessage` endpoint detects
`toolKey` in the body:
- Validates payload against `ToolDefinition.jsonSchema`.
- Injects payload into the AI message processing context as a pre-formed tool call
  result (skipping the LLM tool-calling loop for direct form submissions).
- The AI still generates the prose acknowledgment.

### Validation
`ajv` validates `formPayload` against the `ToolDefinition.jsonSchema` server-side.
Client-side validation is cosmetic only (do not trust it).

---

## 3.3 — Image vision (AI reads uploaded images)

### Problem
Visitors upload screenshots ("What's wrong with this error?") but the AI responds
blindly — it only sees the filename.

### Current state
Spec 22 § Feature 3 covers attachment extraction for text-based files (PDF,
DOCX). It explicitly defers image understanding to a separate item. This is that
item.

### Design

**Vision model routing**

In `apps/api/src/services/ai/agent.service.ts`, when building the user turn and
an attachment is `image/*`:

```typescript
if (attachment.mimeType.startsWith("image/")) {
  // Add vision content block to the LLM message
  userContent.push({
    type: "image_url",
    image_url: {
      url: absoluteAttachmentUrl,
      detail: "high",                   // or "auto" to let the model decide
    },
  });
}
```

The user turn becomes an array of content blocks:
```typescript
messages.push({
  role: "user",
  content: [
    { type: "text", text: customerMessage },
    ...imageBlocks,
  ],
});
```

**Vision model selection**

Not all models support vision. Add a new env var `AI_VISION_MODEL` (default: the
same as `AI_MODEL` if it supports vision, e.g. `openai/gpt-4o`). If
`AI_VISION_MODEL` is unset, fall back to `AI_MODEL`.

OpenRouter supports multimodal content blocks for compatible models.

**Cost awareness**

Vision tokens are significantly more expensive than text tokens. Add a warning in
the system prompt engineering (`prompts.ts`) to be concise when describing images.
Log vision token usage separately in `UsageRecord` with a `hasImages: boolean`
field.

**Image size limit**

Before passing images to the LLM, check image dimensions (use `sharp` or image-
size package for the check). Images over 4 MB or 2048×2048 pixels should be
resized to 768×768 before sending.

```typescript
async function resizeForVision(buffer: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(buffer)
    .resize(768, 768, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}
```

**Widget UX**

No widget change is strictly needed — the existing image thumbnail (spec 22) shows
the image in the chat. The AI's reply will now reference the image content. Add
an optional "AI is reading your image..." status indicator under the thumbnail
while the response is pending.

### User actions required
- Verify the LLM model configured in `AI_MODEL` (or `AI_VISION_MODEL`) supports
  vision on OpenRouter. Check `openrouter.ai/models` for `supports_vision: true`.
  Current default `openai/gpt-4o` does support vision.
- Understand the per-image token cost before enabling in production.

### New env vars
| Variable | Description |
|---|---|
| `AI_VISION_MODEL` | Model for vision requests (default: same as `AI_MODEL`) |
| `AI_VISION_MAX_IMAGE_BYTES` | Max bytes before resizing (default: `4194304` = 4 MB) |

---

## 3.4 — Embedded link previews

### Problem
When the AI replies with a URL (KB article, product page), the customer sees a
plain hyperlink. Open-Graph cards make the link actionable and visually scannable.

### Design

**Server-side OG fetch**

New service `apps/api/src/services/og/preview.service.ts`:
```typescript
import { parse as parseHtml } from "node-html-parser";

export async function fetchOgPreview(url: string): Promise<OgData | null> {
  await assertSafeUrl(url);                    // reuse SSRF guard from spec 30 § 2A.4
  const resp = await fetch(url, {
    method: "GET",
    headers: { "User-Agent": "CSBotPreviewBot/1.0" },
    signal: AbortSignal.timeout(5000),
    redirect: "follow",
  });
  if (!resp.ok) return null;
  const html = await resp.text();
  const root = parseHtml(html);
  const getMeta = (prop: string) =>
    root.querySelector(`meta[property="${prop}"]`)?.getAttribute("content") ??
    root.querySelector(`meta[name="${prop}"]`)?.getAttribute("content") ?? null;

  return {
    url,
    title:       getMeta("og:title")  ?? root.querySelector("title")?.text ?? url,
    description: getMeta("og:description"),
    imageUrl:    getMeta("og:image"),
    siteName:    getMeta("og:site_name"),
    favicon:     `${new URL(url).origin}/favicon.ico`,
  };
}
```

**Caching**

Results cached in Redis (key: `og:<hash(url)>`, TTL: 24 h). Without Redis,
cache in memory (LRU, max 500 entries). Skip fetch if cached.

**Trigger**

In `generateAiReply()`, after the final reply is assembled, scan for URLs:
```typescript
const urls = extractUrls(fullReply).slice(0, 2);  // max 2 previews per message
const previews = await Promise.all(urls.map(u => fetchOgPreview(u).catch(() => null)));
const linkBlocks: LinkPreviewBlock[] = previews.filter(Boolean).map(og => ({
  type: "link_preview", ...og,
}));
```

Append `linkBlocks` to the AI message's `blocks` array (alongside any tool-
result blocks).

**Link preview renderer — `apps/widget/src/components/blocks/LinkPreviewBlock.tsx`**

```tsx
export function LinkPreviewBlockRenderer({ block }: { block: LinkPreviewBlock }) {
  return (
    <a href={block.url} target="_blank" rel="noopener noreferrer"
       className="flex gap-3 border rounded-lg p-2.5 hover:bg-muted/50 transition-colors no-underline">
      {block.imageUrl && (
        <img src={block.imageUrl} alt="" className="w-16 h-16 object-cover rounded flex-shrink-0" />
      )}
      <div className="min-w-0">
        {block.siteName && <p className="text-xs text-muted-foreground">{block.siteName}</p>}
        <p className="text-sm font-medium line-clamp-2">{block.title}</p>
        {block.description && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{block.description}</p>}
      </div>
    </a>
  );
}
```

### SSRF
`fetchOgPreview` calls `assertSafeUrl()` (shared helper from spec 30 § 2A.4).
This must be implemented before link previews ship.

### New env vars
None. Shares `REDIS_URL` (optional) for caching.

---

## Files summary

| File | Change |
|---|---|
| `apps/api/src/models/Message.ts` | Add `blocks?: MessageBlock[]` |
| `apps/api/src/types/messageBlocks.ts` | New — shared block type union |
| `apps/api/src/services/integrations/dispatcher.ts` | `resultToBlocks()` post-processing |
| `apps/api/src/services/ai/agent.service.ts` | Image vision content blocks; OG trigger |
| `apps/api/src/services/og/preview.service.ts` | New — OG fetch + cache |
| `apps/widget/src/components/MessageList.tsx` | Render `blocks` when present |
| `apps/widget/src/components/blocks/BlockRenderer.tsx` | New |
| `apps/widget/src/components/blocks/CardBlock.tsx` | New |
| `apps/widget/src/components/blocks/CarouselBlock.tsx` | New |
| `apps/widget/src/components/blocks/FormBlock.tsx` | New |
| `apps/widget/src/components/blocks/LinkPreviewBlock.tsx` | New |
| `apps/api/src/routes/widget.routes.ts` | Accept `formPayload` + `toolKey` in send-message body |

## New env vars

| Variable | Description |
|---|---|
| `AI_VISION_MODEL` | Model for image-understanding requests (default: `AI_MODEL`) |
| `AI_VISION_MAX_IMAGE_BYTES` | Max image size before resizing (default: `4194304`) |

## Acceptance

- [ ] AI message with a KB article URL renders an Open-Graph preview card.
- [ ] AI replies to a "show me pricing" request with a carousel of plan cards.
- [ ] Customer submits a support-request form → ticket created in Linear with correct fields.
- [ ] Customer uploads a screenshot and asks "What's wrong?" → AI describes the image content.
- [ ] Messages without blocks render as before (backwards compatible).
- [ ] SSRF: OG fetch to a private IP returns `null` (no preview shown), no server error.
