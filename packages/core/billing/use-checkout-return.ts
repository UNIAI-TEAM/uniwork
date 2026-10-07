"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { billingKeys, useSubscription } from "./hooks";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 8;

export type CheckoutReturnState = "success" | "cancel" | null;

/**
 * After VNPay Return URL with checkout=success, IPN may lag; poll subscription
 * until plan_code changes or attempts exhaust (C-04 §6.12).
 */
export function useCheckoutReturn(orgId: string, checkout: CheckoutReturnState) {
  const qc = useQueryClient();
  const sub = useSubscription(orgId);
  const baselinePlan = useRef<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (checkout !== "success" || !orgId) {
      baselinePlan.current = undefined;
      setConfirming(false);
      setTimedOut(false);
      setConfirmed(false);
      return;
    }
    if (baselinePlan.current === undefined && sub.data?.subscription.plan_code) {
      baselinePlan.current = sub.data.subscription.plan_code;
    }
    setConfirming(true);
    setTimedOut(false);
    let polls = 0;
    const tick = () => {
      void qc.invalidateQueries({ queryKey: billingKeys.current(orgId) });
      polls += 1;
      if (polls >= MAX_POLLS) {
        setConfirming(false);
        setTimedOut(true);
      }
    };
    tick();
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [checkout, orgId, qc]);

  useEffect(() => {
    if (checkout !== "success" || !sub.data?.subscription.plan_code) return;
    const base = baselinePlan.current;
    if (base !== undefined && sub.data.subscription.plan_code !== base) {
      setConfirming(false);
      setConfirmed(true);
      setTimedOut(false);
      void qc.invalidateQueries({ queryKey: billingKeys.invoices(orgId) });
    }
  }, [checkout, sub.data?.subscription.plan_code]);

  return { confirming: checkout === "success" && confirming && !confirmed, timedOut, confirmed, canceled: checkout === "cancel" };
}
