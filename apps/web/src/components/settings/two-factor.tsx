"use client";

// Security tab — TOTP-based 2FA. The flow has three states:
//   1. Idle:    user hasn't started yet → "Set up 2FA" button.
//   2. Pending: server returned secret + QR + recovery codes → user scans
//               and types the 6-digit code; we POST /verify to flip on.
//   3. Enabled: user has confirmed → show "Disable 2FA" with a password OR
//               TOTP-code prompt.
// The full setup payload (secret, QR, recovery codes) lives in component
// state and is intentionally NOT persisted client-side — refreshing the
// page during pending state drops the recovery codes, forcing the user to
// re-run setup. That's the correct trade-off: those codes leak power.

import { useState } from "react";
import Image from "next/image";
import { Button, Input, Label } from "@csb/ui";
import { AlertCircle, Check, Copy, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { clientApi, ApiError } from "@/lib/api";

interface SetupResponse {
  secret: string;
  qrCodeDataUrl: string;
  recoveryCodes: string[];
  otpauthUrl?: string;
}

interface Props {
  initialEnabled: boolean;
}

export function TwoFactor({ initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [code, setCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);

  async function startSetup() {
    setBusy(true);
    setError(null);
    try {
      const result = await clientApi.post<SetupResponse>("/auth/2fa/setup");
      setSetup(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup() {
    setBusy(true);
    setError(null);
    try {
      await clientApi.post("/auth/2fa/verify", { code });
      setEnabled(true);
      setSetup(null);
      setCode("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!disablePassword && !disableCode) {
      setError("Enter your password or a current 2FA code to disable.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await clientApi.post("/auth/2fa/disable", {
        password: disablePassword || undefined,
        code: disableCode || undefined,
      });
      setEnabled(false);
      setDisablePassword("");
      setDisableCode("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyRecoveryCodes() {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.recoveryCodes.join("\n"));
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 1500);
    } catch {
      /* ignore */
    }
  }

  function downloadRecoveryCodes() {
    if (!setup) return;
    const blob = new Blob([setup.recoveryCodes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "csb-2fa-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 font-display text-base font-semibold">
            <ShieldCheck className="h-4 w-4" />
            Two-factor authentication
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a second factor (TOTP) to every operator login.
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            enabled
              ? "bg-emerald-500/15 text-emerald-600"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-5">
        {/* --- ENABLED: show Disable form ---------------------------------- */}
        {enabled && !setup && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              2FA is currently protecting your account. To turn it off, confirm with your password
              OR a currently valid 6-digit code from your authenticator app.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Password
                </Label>
                <Input
                  type="password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Or current 2FA code
                </Label>
                <Input
                  inputMode="numeric"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                />
              </div>
            </div>
            <Button variant="outline" onClick={disable} disabled={busy} className="gap-2">
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldOff className="h-3.5 w-3.5" />
              )}
              Disable 2FA
            </Button>
          </div>
        )}

        {/* --- IDLE: prompt to start setup --------------------------------- */}
        {!enabled && !setup && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              You&apos;ll scan a QR code in your authenticator app (1Password, Google
              Authenticator, Authy, …) and confirm a 6-digit code to finish enabling.
            </p>
            <div>
              <Button onClick={startSetup} disabled={busy} className="gap-2">
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                Set up 2FA
              </Button>
            </div>
          </div>
        )}

        {/* --- PENDING: scan QR + confirm code ----------------------------- */}
        {setup && !enabled && (
          <div className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
              <div className="flex h-[200px] w-[200px] items-center justify-center rounded-md border border-border bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <Image
                  src={setup.qrCodeDataUrl}
                  alt="2FA QR code"
                  width={180}
                  height={180}
                  unoptimized
                />
              </div>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Or enter this code manually
                  </Label>
                  <code className="mt-1 block break-all rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs">
                    {setup.secret}
                  </code>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Verification code
                  </Label>
                  <Input
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    className="mt-1 font-mono"
                  />
                </div>
                <Button onClick={confirmSetup} disabled={busy || code.length < 6}>
                  {busy ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Verifying…
                    </>
                  ) : (
                    "Verify and enable"
                  )}
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200">
              <div className="font-semibold">Recovery codes — save these now</div>
              <p className="mt-1 text-xs">
                Each code works exactly once and lets you recover access if you lose your
                authenticator. You will NOT see these again.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
                {setup.recoveryCodes.map((c) => (
                  <span key={c} className="rounded bg-background/60 px-2 py-1">
                    {c}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={copyRecoveryCodes} className="gap-1.5">
                  {copiedCodes ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedCodes ? "Copied" : "Copy"}
                </Button>
                <Button size="sm" variant="outline" onClick={downloadRecoveryCodes}>
                  Download .txt
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
