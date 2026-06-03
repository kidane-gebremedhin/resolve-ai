// SMTP mailer backed by the platform's stored SMTP settings
// (PlatformSetting.smtp, configured in the admin panel). When SMTP is not
// configured the mailer is a graceful no-op + warning — callers never need to
// guard. The transport is rebuilt when the settings change (cheap; cached by a
// hash of the config).

import nodemailer, { type Transporter } from "nodemailer";
import { PlatformSetting } from "../models/index.js";
import { logger } from "../config/logger.js";

type SmtpConfig = {
  host: string;
  port: number;
  username: string;
  secret: string;
  fromEmail: string;
};

let cached: { key: string; transport: Transporter } | null = null;

async function loadSmtp(): Promise<SmtpConfig | null> {
  const s = await PlatformSetting.findOne({ singleton: "global" }).select("smtp").lean();
  const smtp = s?.smtp;
  if (!smtp?.host || !smtp.fromEmail) return null;
  return {
    host: smtp.host,
    port: smtp.port ?? 587,
    username: smtp.username ?? "",
    secret: smtp.secret ?? "",
    fromEmail: smtp.fromEmail,
  };
}

function transportFor(cfg: SmtpConfig): Transporter {
  const key = `${cfg.host}:${cfg.port}:${cfg.username}`;
  if (cached?.key === key) return cached.transport;
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: cfg.username ? { user: cfg.username, pass: cfg.secret } : undefined,
  });
  cached = { key, transport };
  return transport;
}

export async function sendMail(args: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<boolean> {
  const cfg = await loadSmtp();
  if (!cfg) {
    logger.warn("[mailer] SMTP not configured — skipping email", { to: args.to, subject: args.subject });
    return false;
  }
  try {
    await transportFor(cfg).sendMail({
      from: cfg.fromEmail,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text ?? args.html.replace(/<[^>]+>/g, " "),
    });
    return true;
  } catch (err) {
    logger.error("[mailer] send failed", { to: args.to, err: (err as Error).message });
    return false;
  }
}
