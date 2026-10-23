"use client";

import { useEffect } from "react";
import { subscribeQuotaThreshold, type QuotaThresholdEvent } from "./quota-threshold-bus";

/**
 * Listens for organization quota threshold realtime events aimed at the
 * signed-in user. Display (toast) stays in views; this hook only filters and
 * forwards (C-05).
 */
export function useQuotaWarnings(options: {
  organizationId: string | undefined;
  userId: string | undefined;
  onThreshold: (event: QuotaThresholdEvent) => void;
}): void {
  const { organizationId, userId, onThreshold } = options;

  useEffect(() => {
    if (!organizationId || !userId) return;
    return subscribeQuotaThreshold((event) => {
      if (event.organizationId !== organizationId || event.userId !== userId) return;
      onThreshold(event);
    });
  }, [organizationId, userId, onThreshold]);
}
