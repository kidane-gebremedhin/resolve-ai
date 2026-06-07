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

interface HostConfig {
  type: "csb:host-config";
  url: string;
  title: string;
  locale: string;
  position: Position;
  theme: string;
}

interface IncomingMessage {
  type?: string;
  width?: number;
  height?: number;
}

const STYLE_ID = "csb-widget-style";
const IFRAME_ID = "csb-widget-iframe";
const LAUNCHER_ID = "csb-widget-launcher";

(async function bootstrap(): Promise<void> {
  const currentScript = (document.currentScript as HTMLScriptElement | null) ?? null;
  if (!currentScript) {
    console.warn("[csb-widget] could not locate currentScript; skipping inject.");
    return;
  }

  const ds = currentScript.dataset;
  // Widget origin: explicit data-widget-url wins, else the build-time
  // VITE_WIDGET_URL. No host is hardcoded; if neither is set we abort below.
  const widgetUrl =
    ds.widgetUrl ??
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_WIDGET_URL) ??
    "";
  const agentKey = ds.agent ?? ds.agentId ?? "";
  if (!agentKey) {
    console.warn("[csb-widget] missing data-agent / data-agent-id; aborting.");
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
  const fetched = await fetchAppearance(apiOrigin, agentKey);

  const position = normalizePosition(ds.position ?? fetched?.position);
  const primaryColor = ds.primaryColor ?? fetched?.primaryColor ?? "";
  const theme = ds.theme ?? fetched?.theme ?? "auto";

  injectStyles(position);

  // Build the iframe src up front so the launcher only needs to swap visibility.
  // We forward only the agent id plus the cosmetic hints — the widget resolves
  // the org/website (and the authoritative settings) from the agent itself.
  const params = new URLSearchParams();
  params.set("agentId", agentKey);
  if (theme) params.set("theme", theme);
  if (primaryColor) params.set("primaryColor", primaryColor);
  try {
    params.set("domain", window.location.hostname);
  } catch {
    /* sandboxed contexts: ignore */
  }
  const iframeSrc = `${widgetUrl}${widgetUrl.includes("?") ? "&" : "?"}${params.toString()}`;

  const launcher = createLauncher();
  if (primaryColor) launcher.style.background = primaryColor;
  document.body.appendChild(launcher);

  let iframe: HTMLIFrameElement | null = null;
  let initialised = false;

  function ensureIframe(): HTMLIFrameElement {
    if (iframe) return iframe;
    iframe = document.createElement("iframe");
    iframe.id = IFRAME_ID;
    iframe.title = "Chat widget";
    iframe.src = iframeSrc;
    iframe.setAttribute("allow", "clipboard-write; microphone; autoplay");
    iframe.setAttribute("aria-label", "Customer support chat");
    iframe.dataset.position = position;
    document.body.appendChild(iframe);
    return iframe;
  }

  function openWidget(): void {
    const el = ensureIframe();
    el.style.display = "block";
    launcher.style.display = "none";
  }

  function closeWidget(): void {
    if (iframe) iframe.style.display = "none";
    launcher.style.display = "flex";
  }

  launcher.addEventListener("click", () => {
    openWidget();
  });

  window.addEventListener("message", (event: MessageEvent<IncomingMessage>) => {
    if (event.origin !== widgetOrigin) return;
    const data = event.data;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;

    switch (data.type) {
      case "csb:ready": {
        initialised = true;
        sendHostConfig();
        break;
      }
      case "csb:resize": {
        if (!iframe) break;
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
    };
    iframe.contentWindow.postMessage(config, widgetOrigin);
  }

  // If the widget loads quickly we may have missed `csb:ready`; resend on iframe load.
  // We can't bind to iframe.load before it exists, so listen lazily.
  const onIframeLoad = (): void => {
    if (initialised) sendHostConfig();
  };
  const mo = new MutationObserver(() => {
    const el = document.getElementById(IFRAME_ID) as HTMLIFrameElement | null;
    if (el) {
      el.addEventListener("load", onIframeLoad, { once: false });
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true });
})();

function normalizePosition(raw: string | undefined): Position {
  if (raw === "bottom-left" || raw === "centered") return raw;
  return "bottom-right";
}

interface Appearance {
  position?: string;
  primaryColor?: string;
  theme?: string;
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
      ${positionCss(position)}
      width: 400px;
      height: min(680px, calc(100dvh - 48px));
      max-width: calc(100vw - 24px);
      max-height: calc(100dvh - 40px);
      border: 0;
      border-radius: 18px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.20);
      z-index: 2147483647;
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
      width: 60px;
      height: 60px;
      border-radius: 9999px;
      border: 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #111827;
      color: #ffffff;
      box-shadow: 0 10px 28px rgba(0,0,0,0.24);
      z-index: 2147483647;
      transition: transform 140ms ease, box-shadow 140ms ease;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #${LAUNCHER_ID}:hover { transform: scale(1.06); box-shadow: 0 14px 34px rgba(0,0,0,0.28); }
    #${LAUNCHER_ID}:active { transform: scale(0.96); }
    @media (max-width: 480px) {
      #${IFRAME_ID} {
        width: calc(100vw - 16px);
        height: calc(100vh - 40px);
        right: 8px;
        left: 8px;
        bottom: 8px;
        top: auto;
        transform: none;
        border-radius: 12px;
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

function createLauncher(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.id = LAUNCHER_ID;
  btn.type = "button";
  btn.setAttribute("aria-label", "Open chat");
  btn.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  return btn;
}
