"use client";

// Reaching the gated /app dashboard means the subscription is active — i.e.
// checkout is complete — so drop any plan stashed during the pricing → checkout
// flow. Without this, a stale plan in sessionStorage would auto-reopen its
// Paddle overlay the next time the user visits /checkout.

import { useEffect } from "react";
import { PLAN_STORAGE_KEY } from "./plan-cta";

export function ClearCheckoutPlan() {
  useEffect(() => {
    try {
      sessionStorage.removeItem(PLAN_STORAGE_KEY);
    } catch {
      /* sessionStorage unavailable */
    }
  }, []);
  return null;
}
