// SMTP mailer backed by the platform's stored SMTP settings
// (PlatformSetting.smtp, configured in the admin panel). When SMTP is not
// configured the mailer is a graceful no-op + warning — callers never need to
// guard. The transport is rebuilt when the settings change (cheap; cached by a
// hash of the config).

import nodemailer, { type Transporter } from "nodemailer";
import { openSecret } from "./security/secret-field.js";
import { PlatformSetting } from "../models/index.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";

type SmtpConfig = {
  host: string;
  port: number;
  username: string;
  secret: string;
  fromEmail: string;
  // Force TLS-on-connect (implicit TLS). Undefined → inferred from the port (465).
  secure?: boolean;
  source: "db" | "env";
};

let cached: { key: string; transport: Transporter } | null = null;

async function loadSmtp(): Promise<SmtpConfig | null> {
  // Prefer the admin-panel SMTP settings when configured…
  const s = await PlatformSetting.findOne({ singleton: "global" }).select("smtp").lean();
  const smtp = s?.smtp;
  if (smtp?.host && smtp.fromEmail) {
    return {
      host: smtp.host,
      port: smtp.port ?? 587,
      username: smtp.username ?? "",
      // Stored sealed; openSecret() also passes through legacy plaintext.
      secret: openSecret(smtp.secret),
      fromEmail: smtp.fromEmail,
      source: "db",
    };
  }
  // …otherwise fall back to the SMTP_* env vars, so credentials placed in .env
  // send mail without needing the admin panel to be filled in first.
  const e = env.smtp;
  if (e.host && e.from) {
    return {
      host: e.host,
      port: e.port,
      username: e.user ?? "",
      secret: e.pass ?? "",
      fromEmail: e.from,
      secure: e.secure,
      source: "env",
    };
  }
  return null;
}

function transportFor(cfg: SmtpConfig): Transporter {
  // Port 465 is ALWAYS implicit TLS — force it even if SMTP_SECURE was left false (a
  // common misconfiguration that otherwise fails the TLS handshake). Other ports (587/25)
  // use STARTTLS and honour the explicit flag.
  const secure = cfg.port === 465 || cfg.secure === true;
  const key = `${cfg.host}:${cfg.port}:${cfg.username}:${secure}`;
  if (cached?.key === key) return cached.transport;
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure,
    auth: cfg.username ? { user: cfg.username, pass: cfg.secret } : undefined,
  });
  cached = { key, transport };
  return transport;
}

// Escape a display name for use in a `"Name" <email>` From header — strip quotes,
// backslashes and control chars so a brand name can never break out of the header.
function sanitizeFromName(name: string): string {
  return name.replace(/["\\\r\n]/g, "").trim().slice(0, 64);
}

export async function sendMail(args: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  // Optional display name for the From header (e.g. the operator's brand), so a
  // customer sees "Example Support" rather than the bare platform sender address. The
  // sending ADDRESS is always the configured SMTP address (we can't send as the
  // operator's domain) — only the friendly name changes.
  fromName?: string;
}): Promise<boolean> {
  const cfg = await loadSmtp();
  if (!cfg) {
    logger.warn("[mailer] SMTP not configured (no admin-panel settings and no SMTP_* env) — skipping email", {
      to: args.to,
      subject: args.subject,
    });
    return false;
  }
  const name = args.fromName ? sanitizeFromName(args.fromName) : "";
  const from = name ? `"${name}" <${cfg.fromEmail}>` : cfg.fromEmail;
  try {
    await transportFor(cfg).sendMail({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text ?? args.html.replace(/<[^>]+>/g, " "),
    });
    return true;
  } catch (err) {
    logger.error("[mailer] send failed", { to: args.to, source: cfg.source, err: (err as Error).message });
    return false;
  }
}
