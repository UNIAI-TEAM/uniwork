"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveInviteLink } from "@uniwork/core/api/endpoints/meetings";
import { paths } from "@uniwork/core/paths";
import { Button } from "@uniwork/ui/components/ui/button";
import { AppLink } from "../navigation";

export function MeetingPublicInviteView({ linkId, secret }: { linkId: string; secret: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "ok" | "expired" | "error">("loading");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");

  useEffect(() => {
    void resolveInviteLink(linkId, secret).then((res) => {
      if (!res) {
        setState("error");
        return;
      }
      setTitle(res.title);
      setStartsAt(res.starts_at);
      setState(res.expired ? "expired" : "ok");
    });
  }, [linkId, secret]);

  if (state === "loading") {
    return <p className="p-8 text-muted-foreground">{t("common.loading")}</p>;
  }
  if (state === "expired") {
    return <p className="p-8 text-muted-foreground">{t("meetings.publicInviteExpired")}</p>;
  }
  if (state === "error") {
    return <p className="p-8 text-muted-foreground">{t("common.error")}</p>;
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-8">
      <h1 className="text-title font-semibold text-foreground">{t("meetings.publicInviteTitle")}</h1>
      <p className="text-body text-foreground">{title}</p>
      <p className="text-label tabular-nums text-muted-foreground">
        {new Date(startsAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}
      </p>
      <Button render={<AppLink href={paths.login()} />}>{t("meetings.publicInviteLogin")}</Button>
    </div>
  );
}
