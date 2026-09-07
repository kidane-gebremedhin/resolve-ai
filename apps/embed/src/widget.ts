// Embed loader script.
//
// Reads data-* attributes from the host <script> tag, mounts a lazy launcher
// button, and on click injects an iframe pointing at the widget app. A
// postMessage bridge between the host page and the iframe handles resize,
// open/close, and a one-shot "host config" handshake so the widget knows the
// embedding page's URL/title/locale.
//
// Recognised data-* attributes (on the script tag):
//   data-widget-url       Required. Origin of the widget app (e.g. https://widget.example.com).
//   data-agent | data-agent-id  Required. Public agent key/id. The widget API
//                         derives the organization and website from the agent,
//                         so no org/website IDs are needed on the tag.
//   data-position         "bottom-right" (default) | "bottom-left" | "centered".
//   data-primary-color    Optional. Hex/CSS colour forwarded as a query param.
//   data-theme            "light" | "dark" | "auto" (default auto).
//
// The cosmetic attributes (position/primary-color/theme) only style the launcher
// before the iframe loads; the widget itself fetches the authoritative settings
// from /widget/init by agent id, so the embedded widget always reflects the
// operator's saved Widget Studio configuration.
//
// postMessage protocol (origin must match the widget URL origin):
//   iframe → host: { type: "csb:ready" }
//   iframe → host: { type: "csb:resize", width, height }
//   iframe → host: { type: "csb:close" }   // collapse to launcher
//   iframe → host: { type: "csb:open" }    // restore iframe (if a host trigger pre-mounted it)
//   host   → iframe: { type: "csb:host-config", url, title, locale, position, theme }

type Position = "bottom-right" | "bottom-left" | "centered";

interface ProactiveTrigger {
  _id: string;
  conditions: Array<{ type: string; params: Record<string, unknown> }>;
  conditionLogic: "AND" | "OR";
  message: string;
  delayMs: number;
  cooldownMs: number;
  maxFires: number;
}

interface HostConfig {
  type: "csb:host-config";
  url: string;
  title: string;
  locale: string;
  position: Position;
  theme: string;
  fullscreen: boolean;
}

interface IncomingMessage {
  type?: string;
  width?: number;
  height?: number;
}

const STYLE_ID = "csb-widget-style";
const IFRAME_ID = "csb-widget-iframe";
const LAUNCHER_ID = "csb-widget-launcher";
const BADGE_ID = "csb-unread-badge";

// Launcher icons. Heroicons (https://heroicons.com) paths inlined so the embed
// bundle stays dependency-free. Open icon = `chat-bubble-bottom-center-text`
// (24/outline); close icon = `x-mark` (24/outline).
const CHAT_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"/></svg>';
const CLOSE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 18 18 6M6 6l12 12"/></svg>';

// ---- Proactive notification sound -----------------------------------------
// A proactive message auto-opens the widget WITHOUT any interaction inside the
// iframe, so the iframe's own AudioContext is still suspended and its beep is
// muted by the browser autoplay policy. The embed runs in the HOST page, which
// usually already has user activation (the visitor has been browsing/clicking),
// so we play the beep here instead — that's what lets it sound on auto-open.
// The context is primed on the first gesture anywhere on the host page.
let embedAudioCtx: AudioContext | null = null;
// Set when a proactive beep was requested while audio was still locked (no user
// gesture yet). The browser forbids sound until the visitor's first real
// click/tap/keypress; we fire the queued beep the very instant that happens —
// the earliest moment sound is physically allowed. (Synthetic clicks can't help:
// browsers only accept `isTrusted` gestures for the autoplay unlock.)
let pendingProactiveBeep = false;
function emitBeepTones(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const tone = (freq: number, at: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.05, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.1);
  };
  tone(880, now);
  tone(1320, now + 0.09);
}
function flushPendingBeep(): void {
  if (pendingProactiveBeep && embedAudioCtx && embedAudioCtx.state === "running") {
    pendingProactiveBeep = false;
    try {
      emitBeepTones(embedAudioCtx);
    } catch {
      /* ignore */
    }
  }
}
function primeEmbedAudio(): void {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  const unlock = () => {
    try {
      if (!embedAudioCtx) embedAudioCtx = new Ctor();
      if (embedAudioCtx.state === "suspended") {
        void embedAudioCtx.resume().then(flushPendingBeep).catch(() => undefined);
      } else {
        flushPendingBeep();
      }
    } catch {
      /* ignore */
    }
  };
  // Create eagerly (may start suspended) + resume on first gesture.
  unlock();
  const opts = { capture: true, passive: true } as const;
  for (const ev of ["pointerdown", "touchstart", "keydown", "scroll"]) {
    window.addEventListener(ev, unlock, opts);
  }
}
function playProactiveBeep(): void {
  try {
    if (!embedAudioCtx) return;
    if (embedAudioCtx.state === "running") {
      emitBeepTones(embedAudioCtx);
      return;
    }
    // Audio still locked — queue it and try to resume (works only once a real
    // gesture has happened). flushPendingBeep() fires it the moment that occurs.
    pendingProactiveBeep = true;
    void embedAudioCtx.resume().then(flushPendingBeep).catch(() => undefined);
  } catch {
    /* audio is best-effort */
  }
}

(async function bootstrap(): Promise<void> {
  const currentScript = (document.currentScript as HTMLScriptElement | null) ?? null;
  if (!currentScript) {
    console.warn("[csb-widget] could not locate currentScript; skipping inject.");
    return;
  }

  // Prime the host-page audio context so a proactive beep can sound on auto-open.
  primeEmbedAudio();

  const ds = currentScript.dataset;
  // Config can arrive two ways:
  //  1. `window.AddisAIConfig = { apiBase, websiteId, agentId, domain, widgetUrl }`
  //     — the copy-paste snippet the dashboard generates (Websites → Embed).
  //  2. `data-*` attributes on the <script> tag — the legacy/manual form.
  // data-* wins when present; otherwise fall back to AddisAIConfig. We read the
  // global (not just currentScript) because the snippet injects widget.js async,
  // so `document.currentScript` is the injected tag with no attributes on it.
  const cfg =
    ((window as unknown as { AddisAIConfig?: Record<string, string | undefined> }).AddisAIConfig) ?? {};

  // Widget origin: explicit data-widget-url / AddisAIConfig.widgetUrl wins, else
  // the build-time VITE_WIDGET_URL. No host is hardcoded; if none set we abort.
  const widgetUrl =
    ds.widgetUrl ??
    cfg.widgetUrl ??
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_WIDGET_URL) ??
    "";
  const agentKey = ds.agent ?? ds.agentId ?? cfg.agentId ?? cfg.agent ?? "";
  if (!agentKey) {
    console.warn("[csb-widget] missing agentId (data-agent / data-agent-id / AddisAIConfig.agentId); aborting.");
    return;
  }
  if (!widgetUrl) {
    console.warn("[csb-widget] missing data-widget-url; aborting.");
    return;
  }

  let widgetOrigin: string;
  try {
    widgetOrigin = new URL(widgetUrl).origin;
  } catch {
    console.warn("[csb-widget] invalid data-widget-url:", widgetUrl);
    return;
  }

  // Resolve the API origin (distinct from the widget origin): explicit attribute,
  // then build-time env, then fall back to the widget origin (and warn).
  const apiUrl =
    ds.apiUrl ??
    cfg.apiBase ??
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) ??
    "";
  let apiOrigin: string;
  try {
    apiOrigin = apiUrl ? new URL(apiUrl).origin : widgetOrigin;
    if (!apiUrl) {
      console.warn("[csb-widget] no data-api-url / VITE_API_URL; using widget origin for appearance.");
    }
  } catch {
    apiOrigin = widgetOrigin;
  }

  // Fetch saved appearance by agentId so launcher styling reflects the operator's
  // studio settings WITHOUT re-copying the snippet. data-* attributes still win.
  const [fetched, triggers] = await Promise.all([
    fetchAppearance(apiOrigin, agentKey),
    fetchTriggers(apiOrigin, agentKey),
  ]);

  const position = normalizePosition(ds.position ?? fetched?.position);
  const primaryColor = ds.primaryColor ?? fetched?.primaryColor ?? "";
  const theme = ds.theme ?? fetched?.theme ?? "auto";
  // Only grant the iframe microphone access when the operator has enabled voice
  // input — otherwise some browsers prompt for device access on page load.
  const voiceEnabled = fetched?.voiceInput === true;

  injectStyles(position);

  // Build the iframe src up front so the launcher only needs to swap visibility.
  // We forward only the agent id plus the cosmetic hints — the widget resolves
  // the org/website (and the authoritative settings) from the agent itself.
  const params = new URLSearchParams();
  params.set("agentId", agentKey);
  if (theme) params.set("theme", theme);
  if (primaryColor) params.set("primaryColor", primaryColor);
  // Domain is only a fallback resolver (the widget resolves by agentId first).
  // Prefer the operator-configured website domain from AddisAIConfig; otherwise
  // use the embedding page's hostname.
  try {
    const domain = cfg.domain ?? window.location.hostname;
    if (domain) params.set("domain", domain);
  } catch {
    /* sandboxed contexts: ignore */
  }
  const iframeSrc = `${widgetUrl}${widgetUrl.includes("?") ? "&" : "?"}${params.toString()}`;

  const launcher = createLauncher();
  if (primaryColor) launcher.style.background = primaryColor;
  document.body.appendChild(launcher);

  // Inject unread badge into launcher (absolute-positioned at top-right).
  // The launcher is position:fixed so its children can be position:absolute.
  const badge = document.createElement("div");
  badge.id = BADGE_ID;
  badge.setAttribute("aria-live", "polite");
  badge.setAttribute("aria-label", "Unread messages");
  Object.assign(badge.style, {
    position: "absolute",
    top: "-5px",
    right: "-5px",
    minWidth: "18px",
    height: "18px",
    borderRadius: "9999px",
    background: "#ef4444",
    color: "#fff",
    fontSize: "10px",
    fontWeight: "700",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 4px",
    pointerEvents: "none",
    lineHeight: "1",
    boxSizing: "border-box",
  });
  launcher.style.overflow = "visible";
  launcher.appendChild(badge);

  let unreadCount = 0;

  function showBadge(count: number): void {
    unreadCount = count;
    badge.textContent = String(count > 99 ? "99+" : count);
    badge.style.display = "flex";
  }

  function hideBadge(): void {
    unreadCount = 0;
    badge.style.display = "none";
  }

  let iframe: HTMLIFrameElement | null = null;
  let initialised = false;
  let isOpen = false;
  // Once the visitor has opened the widget (manually or via a proactive nudge),
  // we stop firing further proactive triggers — re-popping the widget after the
  // visitor has already engaged is intrusive.
  let hasOpenedOnce = false;
  let pendingProactivePayload: { triggerId: string; message: string } | null = null;

  // Hide the panel WITHOUT `display:none`. A display:none iframe has its event loop
  // (and its Socket.io connection) suspended/throttled by the browser, so live
  // messages that arrive while the widget is collapsed are never received — the
  // unread badge then only appears after a page reload (which re-fetches). Keeping
  // the iframe rendered but `visibility:hidden` + non-interactive keeps the socket
  // alive so unread counting works live while collapsed.
  function hidePanel(el: HTMLIFrameElement): void {
    el.style.display = "block";
    el.style.visibility = "hidden";
    el.style.pointerEvents = "none";
  }
  function showPanel(el: HTMLIFrameElement): void {
    el.style.display = "block";
    el.style.visibility = "visible";
    el.style.pointerEvents = "auto";
  }

  function ensureIframe(): HTMLIFrameElement {
    if (iframe) return iframe;
    iframe = document.createElement("iframe");
    iframe.id = IFRAME_ID;
    iframe.title = "Chat widget";
    iframe.src = iframeSrc;
    // `microphone` is only delegated when voice input is enabled (see voiceEnabled) so
    // the widget never triggers an on-load device-permission prompt for the common
    // (voice-off) case. The mic itself is still only accessed when the visitor presses
    // the mic button inside the widget.
    iframe.setAttribute(
      "allow",
      voiceEnabled ? "clipboard-write; microphone; autoplay" : "clipboard-write; autoplay",
    );
    iframe.setAttribute("aria-label", "Customer support chat");
    iframe.dataset.position = position;
    // Start hidden (but alive) so the widget can boot, keep its socket open, and
    // post live unread counts without showing the panel.
    hidePanel(iframe);
    document.body.appendChild(iframe);
    return iframe;
  }

  // The launcher ALWAYS stays visible (like Intercom/Crisp/seobuddy) — it just
  // toggles its icon between "chat" (closed) and "close/✕" (open) and the panel
  // opens above it.
  function setLauncherOpenState(open: boolean): void {
    isOpen = open;
    launcher.innerHTML = open ? CLOSE_ICON_SVG : CHAT_ICON_SVG;
    launcher.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function openWidget(): void {
    const el = ensureIframe();
    showPanel(el);
    hasOpenedOnce = true;
    setLauncherOpenState(true);
    hideBadge();
    // Notify the widget it's now visible so it can reset its unread counter.
    el.contentWindow?.postMessage({ type: "csb:widget-opened" }, widgetOrigin);
    // On phones the panel is fullscreen and the widget shows its own top-right
    // ✕ (posts csb:close); hide the floating launcher while open so there isn't
    // a redundant close control. On desktop the launcher stays (toggles to ✕).
    if (isFullscreenViewport()) launcher.style.display = "none";
  }

  function closeWidget(): void {
    if (iframe) {
      // Notify the widget it's now hidden FIRST (while it's still fully alive) so it
      // reliably flips to "collapsed" and starts accumulating unread, THEN visually
      // hide the (still-running) panel.
      iframe.contentWindow?.postMessage({ type: "csb:widget-closed" }, widgetOrigin);
      hidePanel(iframe);
    }
    setLauncherOpenState(false);
    // Restore the launcher (CSS controls its real display) so it's tappable to
    // reopen — needed after it was hidden while open on a phone.
    launcher.style.display = "";
  }

  launcher.addEventListener("click", () => {
    if (isOpen) closeWidget();
    else openWidget();
  });

  window.addEventListener("message", (event: MessageEvent<IncomingMessage>) => {
    if (event.origin !== widgetOrigin) return;
    const data = event.data;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;

    switch (data.type) {
      case "csb:ready": {
        initialised = true;
        sendHostConfig();
        // Re-deliver any proactive trigger that fired before the widget was ready
        if (pendingProactivePayload && iframe?.contentWindow) {
          iframe.contentWindow.postMessage(
            { type: "csb:proactive", ...pendingProactivePayload },
            widgetOrigin,
          );
          pendingProactivePayload = null;
        }
        break;
      }
      case "csb:request-config": {
        // The widget mounted its listener and is asking for host-config. Reply
        // so it learns the fullscreen state without racing the load-time send.
        sendHostConfig();
        break;
      }
      case "csb:resize": {
        if (!iframe) break;
        // On phones the panel is fullscreen (CSS above, with !important). Ignore
        // the widget's requested size so we don't fight the fullscreen layout.
        if (isFullscreenViewport()) break;
        if (typeof data.width === "number" && data.width > 0) {
          iframe.style.width = `${Math.round(data.width)}px`;
        }
        if (typeof data.height === "number" && data.height > 0) {
          iframe.style.height = `${Math.round(data.height)}px`;
        }
        break;
      }
      case "csb:close": {
        closeWidget();
        break;
      }
      case "csb:open": {
        openWidget();
        break;
      }
      case "csb:unread": {
        // Widget reports how many messages arrived while hidden.
        const count = typeof (data as Record<string, unknown>).count === "number"
          ? (data as Record<string, unknown>).count as number
          : 0;
        if (count === 0) hideBadge();
        else if (!isOpen) showBadge(count);
        break;
      }
      default:
        // unknown event — ignored
        break;
    }
  });

  function sendHostConfig(): void {
    if (!iframe || !iframe.contentWindow) return;
    const config: HostConfig = {
      type: "csb:host-config",
      url: safeLocationHref(),
      title: document.title || "",
      locale:
        document.documentElement.lang ||
        (typeof navigator !== "undefined" ? navigator.language : "") ||
        "en",
      position,
      theme,
      fullscreen: isFullscreenViewport(),
    };
    iframe.contentWindow.postMessage(config, widgetOrigin);
  }

  // Re-send host config on resize so the widget knows when to show/hide its
  // own close button (fullscreen on phones vs. floating card on desktop).
  let lastFullscreen = isFullscreenViewport();
  window.addEventListener("resize", () => {
    const nowFullscreen = isFullscreenViewport();
    if (nowFullscreen !== lastFullscreen) {
      lastFullscreen = nowFullscreen;
      sendHostConfig();
    }
  });

  // Send host-config (including fullscreen state) every time the iframe loads so
  // the widget knows whether to show its mobile close button. We always send —
  // not just when `initialised` is true — because the widget doesn't emit
  // csb:ready, so `initialised` is never set and the button would stay hidden.
  const onIframeLoad = (): void => {
    sendHostConfig();
  };
  const mo = new MutationObserver(() => {
    const el = document.getElementById(IFRAME_ID) as HTMLIFrameElement | null;
    if (el) {
      el.addEventListener("load", onIframeLoad, { once: false });
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true });

  // Eagerly create and boot the iframe (hidden) so the widget can report the
  // initial unread count on page load without waiting for the user to open it.
  ensureIframe();

  // Set up proactive triggers after the embed is fully initialised.
  if (triggers.length > 0) {
    setupTriggers(triggers, agentKey, widgetOrigin, () => {
      if (!isOpen) openWidget();
      // Suppress further proactive triggers once the widget is open OR has been
      // opened/engaged at any point this session.
    }, () => isOpen || hasOpenedOnce, (payload) => { pendingProactivePayload = payload; });
  }
})();

function normalizePosition(raw: string | undefined): Position {
  if (raw === "bottom-left" || raw === "centered") return raw;
  return "bottom-right";
}

// Matches the `@media (max-width: 480px)` breakpoint where the panel is
// fullscreen. Used to ignore the widget's csb:resize requests on phones.
function isFullscreenViewport(): boolean {
  try {
    return window.matchMedia("(max-width: 480px)").matches;
  } catch {
    return false;
  }
}

interface Appearance {
  position?: string;
  primaryColor?: string;
  theme?: string;
  // Whether the widget's voice-input (mic) button is enabled. Only when true do we
  // delegate `microphone` to the iframe — otherwise requesting that capability makes
  // some browsers prompt for device access on page load, before the visitor does
  // anything (voice input is off by default).
  voiceInput?: boolean;
}

// Best-effort: never blocks the launcher for long, never throws. A failed fetch
// just means we fall back to data-* attributes + built-in defaults.
async function fetchAppearance(apiOrigin: string, agentKey: string): Promise<Appearance | null> {
  try {
    const url = `${apiOrigin}/api/v1/widget/appearance?agentId=${encodeURIComponent(agentKey)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(url, { signal: ctrl.signal, credentials: "omit" });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as Appearance;
  } catch {
    return null;
  }
}

async function fetchTriggers(apiOrigin: string, agentKey: string): Promise<ProactiveTrigger[]> {
  try {
    const url = `${apiOrigin}/api/v1/widget/triggers?agentId=${encodeURIComponent(agentKey)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(url, { signal: ctrl.signal, credentials: "omit" });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as { triggers?: ProactiveTrigger[] };
    return data.triggers ?? [];
  } catch {
    return [];
  }
}

function evalCondition(
  condition: ProactiveTrigger["conditions"][number],
  startTime: number,
): boolean {
  const params = condition.params ?? {};
  switch (condition.type) {
    case "time_on_page": {
      const ms = typeof params.ms === "number" ? params.ms : Number(params.seconds ?? 0) * 1000;
      return Date.now() - startTime >= ms;
    }
    case "scroll_depth": {
      const pct = typeof params.percent === "number" ? params.percent : 50;
      const el = document.documentElement;
      const scrolled = ((el.scrollTop + el.clientHeight) / el.scrollHeight) * 100;
      return scrolled >= pct;
    }
    case "exit_intent": {
      // Evaluated via mouseleave; condition always passes when the listener fires.
      return true;
    }
    case "url_match": {
      const pattern = typeof params.pattern === "string" ? params.pattern : "";
      try {
        return new RegExp(pattern).test(window.location.href);
      } catch {
        return window.location.href.includes(pattern);
      }
    }
    case "element_hover": {
      // Evaluated via mouseover on the selector; condition always passes when fired.
      return true;
    }
    default:
      return false;
  }
}

function cooldownKey(triggerId: string): string {
  return `csb:trigger:${triggerId}`;
}

function isOnCooldown(trigger: ProactiveTrigger): boolean {
  try {
    const stored = localStorage.getItem(cooldownKey(trigger._id));
    if (!stored) return false;
    return Date.now() - Number(stored) < trigger.cooldownMs;
  } catch {
    return false;
  }
}

function markFired(trigger: ProactiveTrigger): void {
  try {
    localStorage.setItem(cooldownKey(trigger._id), String(Date.now()));
  } catch {
    // Private browsing / storage quota — best effort.
  }
}

function setupTriggers(
  triggers: ProactiveTrigger[],
  _agentKey: string,
  widgetOrigin: string,
  openFn: () => void,
  isOpenFn: () => boolean,
  onProactiveFire?: (payload: { triggerId: string; message: string }) => void,
): void {
  const startTime = Date.now();
  const fired = new Set<string>();

  function fireTrigger(trigger: ProactiveTrigger): void {
    if (fired.has(trigger._id)) return;
    if (isOnCooldown(trigger)) return;
    // Don't interrupt an already-open widget session.
    if (isOpenFn()) return;
    fired.add(trigger._id);
    markFired(trigger);
    // openFn opens the widget; the suppression guard (isOpenFn) prevents this
    // from re-firing once the visitor has already opened/engaged the widget.
    openFn();
    // Beep from the host page (has user activation) so it's audible on auto-open.
    playProactiveBeep();
    const payload = { triggerId: trigger._id, message: trigger.message };
    // Buffer so csb:ready can re-deliver if the iframe isn't loaded yet.
    onProactiveFire?.(payload);
    // Notify the widget iframe to show the proactive message.
    const el = document.getElementById(IFRAME_ID) as HTMLIFrameElement | null;
    el?.contentWindow?.postMessage(
      { type: "csb:proactive", ...payload },
      widgetOrigin,
    );
  }

  function checkAndFire(trigger: ProactiveTrigger): void {
    if (fired.has(trigger._id) || isOnCooldown(trigger)) return;
    const results = trigger.conditions.map((c) => evalCondition(c, startTime));
    const passes =
      trigger.conditionLogic === "OR"
        ? results.some(Boolean)
        : results.every(Boolean);
    if (passes) {
      if (trigger.delayMs > 0) {
        setTimeout(() => fireTrigger(trigger), trigger.delayMs);
      } else {
        fireTrigger(trigger);
      }
    }
  }

  for (const trigger of triggers) {
    // time_on_page: set a timer for the threshold.
    const timeCondition = trigger.conditions.find((c) => c.type === "time_on_page");
    if (timeCondition) {
      const ms =
        typeof timeCondition.params.ms === "number"
          ? timeCondition.params.ms
          : Number(timeCondition.params.seconds ?? 0) * 1000;
      if (ms > 0) {
        setTimeout(() => checkAndFire(trigger), ms);
      }
    }

    // scroll_depth: check on scroll.
    if (trigger.conditions.some((c) => c.type === "scroll_depth")) {
      window.addEventListener("scroll", () => checkAndFire(trigger), { passive: true });
    }

    // exit_intent: mouseleave on document element.
    if (trigger.conditions.some((c) => c.type === "exit_intent")) {
      document.documentElement.addEventListener("mouseleave", (e) => {
        if ((e as MouseEvent).clientY <= 0) checkAndFire(trigger);
      });
    }

    // url_match: evaluate immediately (page already loaded).
    if (trigger.conditions.some((c) => c.type === "url_match")) {
      checkAndFire(trigger);
    }

    // element_hover: attach mouseover to the selector.
    const hoverCondition = trigger.conditions.find((c) => c.type === "element_hover");
    if (hoverCondition) {
      const selector = typeof hoverCondition.params.selector === "string"
        ? hoverCondition.params.selector
        : "";
      if (selector) {
        document.addEventListener("mouseover", (e) => {
          if ((e.target as Element)?.closest(selector)) checkAndFire(trigger);
        });
      }
    }
  }
}

function safeLocationHref(): string {
  try {
    return window.location.href;
  } catch {
    return "";
  }
}

function injectStyles(position: Position): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${IFRAME_ID} {
      position: fixed;
      ${iframePositionCss(position)}
      width: 400px;
      height: min(680px, calc(100dvh - 120px));
      max-width: calc(100vw - 24px);
      max-height: calc(100dvh - 110px);
      border: 0;
      border-radius: 18px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.20);
      /* One below the launcher so the launcher (✕) stays tappable on top of the
         panel — critical on mobile where the panel goes fullscreen. */
      z-index: 2147483646;
      background: transparent;
      color-scheme: light dark;
      animation: csb-pop 160ms cubic-bezier(0.16,1,0.3,1);
    }
    @keyframes csb-pop {
      from { opacity: 0; transform: translateY(8px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    #${LAUNCHER_ID} {
      position: fixed;
      ${positionCss(position)}
      width: 56px;
      height: 56px;
      border-radius: 9999px;
      border: 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #111827;
      color: #ffffff;
      box-shadow: 0 8px 24px rgba(0,0,0,0.18), 0 2px 4px rgba(0,0,0,0.06);
      z-index: 2147483647;
      transition: transform 200ms cubic-bezier(0.16,1,0.3,1), box-shadow 200ms ease, filter 200ms ease;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #${LAUNCHER_ID}:hover { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(0,0,0,0.22), 0 3px 6px rgba(0,0,0,0.08); filter: brightness(1.04); }
    #${LAUNCHER_ID}:active { transform: translateY(0) scale(0.98); }
    #${LAUNCHER_ID}:focus-visible { outline: 2px solid #ffffff; outline-offset: 3px; }
    @media (max-width: 480px) {
      /* Phones: the panel fills the whole screen (except the floating launcher,
         which sits on top via its higher z-index). !important beats the inline
         width/height the widget sets via csb:resize, so the panel can't shrink
         back to a desktop-sized card. */
      #${IFRAME_ID} {
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        height: 100dvh !important;
        max-width: none !important;
        max-height: none !important;
        border-radius: 0 !important;
        transform: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function positionCss(position: Position): string {
  switch (position) {
    case "bottom-left":
      return "left: 24px; bottom: 24px; right: auto; top: auto;";
    case "centered":
      return "left: 50%; bottom: 24px; right: auto; top: auto; transform: translateX(-50%);";
    case "bottom-right":
    default:
      return "right: 24px; bottom: 24px; left: auto; top: auto;";
  }
}

// The panel opens ABOVE the always-visible launcher (60px tall at bottom: 24px),
// so it's offset up by launcher height + a gap (~96px).
function iframePositionCss(position: Position): string {
  switch (position) {
    case "bottom-left":
      return "left: 24px; bottom: 96px; right: auto; top: auto;";
    case "centered":
      return "left: 50%; bottom: 96px; right: auto; top: auto; transform: translateX(-50%);";
    case "bottom-right":
    default:
      return "right: 24px; bottom: 96px; left: auto; top: auto;";
  }
}

function createLauncher(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.id = LAUNCHER_ID;
  btn.type = "button";
  btn.setAttribute("aria-label", "Open chat");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = CHAT_ICON_SVG;
  return btn;
}
