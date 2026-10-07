"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  clearCheckoutBaseline,
  fingerprintSubscription,
  readCheckoutBaseline,
  subscriptionAppliedAfterCheckout,
  type CheckoutSubscriptionFingerprint,
} from "./checkout-baseline";
import { billingKeys, useSubscription } from "./hooks";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 12;

export type CheckoutReturnState = "success" | "cancel" | null;

/**
 * After VNPay Return URL with checkout=success, IPN may lag; poll subscription
 * until the snapshot changes or attempts exhaust (C-04 §6.12).
 */
export function useCheckoutReturn(orgId: string, checkout: CheckoutReturnState) {
  const qc = useQueryClient();
  const sub = useSubscription(orgId);
  const baseline = useRef<CheckoutSubscriptionFingerprint | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (checkout !== "success" || !orgId) {
      baseline.current = null;
      setConfirming(false);
      setTimedOut(false);
      setConfirmed(false);
      return;
    }
    if (baseline.current === null) {
      baseline.current = readCheckoutBaseline(orgId);
    }
  }, [checkout, orgId]);

  useEffect(() => {
    if (checkout !== "success" || baseline.current !== null || !sub.data?.subscription) return;
    baseline.current = fingerprintSubscription(sub.data.subscription);
  }, [checkout, sub.data?.subscription]);

  useEffect(() => {
    if (checkout !== "success" || !orgId) return;
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
    if (checkout !== "success" || !sub.data?.subscription || baseline.current === null) return;
    if (subscriptionAppliedAfterCheckout(baseline.current, sub.data.subscription)) {
      setConfirming(false);
      setConfirmed(true);
      setTimedOut(false);
      clearCheckoutBaseline(orgId);
      void qc.invalidateQueries({ queryKey: billingKeys.invoices(orgId) });
    }
  }, [checkout, orgId, qc, sub.data?.subscription]);

  return { confirming: checkout === "success" && confirming && !confirmed, timedOut, confirmed, canceled: checkout === "cancel" };
}
