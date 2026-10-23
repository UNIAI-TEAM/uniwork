"use client";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { toastApiError } from "../toast-api-error";

/** The in-room feeds open on their newest page; this reads the page before it. */
export function MeetingFeedLoadOlder({
  label,
  loading,
  onLoad,
}: {
  label: string;
  loading: boolean;
  onLoad: () => Promise<void>;
}) {
  const { t } = useTranslation();
  async function load() {
    try {
      await onLoad();
    } catch (err) {
      toastApiError(err, t("common.error"));
    }
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="w-full text-muted-foreground"
      disabled={loading}
      onClick={() => void load()}
    >
      {label}
    </Button>
  );
}
