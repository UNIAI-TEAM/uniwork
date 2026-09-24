"use client";
import { useRouter } from "next/navigation";

/** Refresh localized server metadata after the shared menu persists its cookie. */
export function useMarketingLocaleRefresh() {
  return useRouter().refresh;
}
