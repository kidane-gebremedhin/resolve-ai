"use client";

// Lifetime-deal coupon redemption, for the billing page.
//
// Two-step on purpose: validate first so the operator sees exactly which plan a
// code grants BEFORE committing, then reveal Redeem. Redemption is irreversible
// from the UI, and an LTD code is usually single-use — "what does this do?"
// deserves an answer that doesn't burn the code.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Loader2, Ticket } from "lucide-react";
import { Button, Input } from "@csb/ui";
import { clientApi, ApiError } from "@/lib/api";

type ValidateResponse =
  | { valid: true; coupon: { code: string; grantsTier: string; description: string | null; partner: string | null } }
  | { valid: false; error: string };

type RedeemResponse = { success: boolean; tierGranted?: string; message: string };

export function CouponRedemption({
  currentPlan,
  canRedeem,
}: {
  /** The org's current plan; null when unsubscribed. */
  currentPlan: string | null;
  /** False for agents/viewers — the API refuses them with 403. */
  canRedeem: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [validated, setValidated] = useState<Extract<ValidateResponse, { valid: true }>["coupon"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Nothing left to grant — enterprise is the top tier, so a coupon could only
  // ever be a downgrade and the API would refuse it. Don't offer the input at all.
  if (currentPlan === "enterprise") return null;
  // Billing is owner/admin territory; showing this to an agent would just
  // produce a 403 on click.
  if (!canRedeem) return null;

  function reset() {
    setValidated(null);
    setError(null);
    setSuccess(null);
  }

  async function validate() {
    const trimmed = code.trim();
    // Below the API's minimum — don't spend a rate-limit slot on it.
    if (trimmed.length < 3) return;
    setChecking(true);
    setError(null);
    try {
      const res = await clientApi.post<ValidateResponse>("/coupons/validate", { code: trimmed });
      if (res.valid) {
        setValidated(res.coupon);
        setError(null);
      } else {
        setValidated(null);
        setError(res.error);
      }
    } catch (err) {
      setValidated(null);
      setError(err instanceof ApiError ? err.message : "Could not check that code.");
    } finally {
      setChecking(false);
    }
  }

  async function redeem() {
    setRedeeming(true);
    setError(null);
    try {
      const res = await clientApi.post<RedeemResponse>("/coupons/redeem", { code: code.trim() });
      if (!res.success) {
        setError(res.message);
        setValidated(null);
        return;
      }
      setSuccess(res.message);
      setValidated(null);
      setCode("");
      // The new plan is read from the database on every request (the dashboard
      // does not cache the tier in a token), so a refresh is enough to reflect it.
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not redeem that code.");
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Ticket className="h-4 w-4 text-primary" />
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Redeem a coupon
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Bought a lifetime deal on AppSumo, PitchGround or StackSocial? Enter the code to upgrade
        this workspace instantly — no card required.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Input
          value={code}
          // Uppercase as they type: codes are stored and compared uppercase, so
          // showing anything else invites "why didn't my code work?".
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            if (validated || error || success) reset();
          }}
          onBlur={() => void validate()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void (validated ? redeem() : validate());
            }
          }}
          placeholder="APPSUMO-XXXX-XXXX"
          className="min-w-[220px] flex-1 font-mono uppercase tracking-wider"
          autoComplete="off"
          spellCheck={false}
          disabled={redeeming}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => void validate()}
          disabled={checking || redeeming || code.trim().length < 3}
        >
          {checking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Check code
        </Button>
        {/* Only revealed once a code actually validates. */}
        {validated && (
          <Button type="button" onClick={() => void redeem()} disabled={redeeming}>
            {redeeming ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Redeem
          </Button>
        )}
      </div>

      {validated && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <div>
            <div className="font-medium text-foreground">
              Valid code — grants the{" "}
              <span className="capitalize">{validated.grantsTier}</span> plan
            </div>
            {validated.description && (
              <p className="mt-0.5 text-muted-foreground">{validated.description}</p>
            )}
            {validated.partner && (
              <p className="mt-0.5 text-xs text-muted-foreground">via {validated.partner}</p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <span className="text-foreground">{success}</span>
        </div>
      )}
    </div>
  );
}
