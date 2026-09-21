"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorCode } from "@uniwork/core/api/http";
import { useConnectEmailHubAccount } from "@uniwork/core/email-hub/hooks";
import { ConnectAppPasswordGuideDialog } from "./connect-app-password-guide-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";

interface ConnectAccountDialogProps {
  wsId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: (accountId: string) => void;
}

export function ConnectAccountDialog({ wsId, open, onOpenChange, onConnected }: ConnectAccountDialogProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const connect = useConnectEmailHubAccount(wsId);

  const connectErrorKey = (() => {
    if (!connect.isError) return null;
    switch (errorCode(connect.error)) {
      case "email_hub_not_configured":
        return "email_hub.connect.error_not_configured";
      case "email_hub_connect_failed":
        return "email_hub.connect.error_connect_failed";
      case "email_hub_unsupported":
        return "email_hub.connect.error_unsupported";
      default:
        return "email_hub.connect.error";
    }
  })();

  const submit = () => {
    connect.mutate(
      { email, appPassword: password },
      {
        onSuccess: (acc) => {
          if (acc) onConnected?.(acc.id);
          setEmail("");
          setPassword("");
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("email_hub.connect.title")}</DialogTitle>
          <DialogDescription>{t("email_hub.connect.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="email-hub-email">{t("email_hub.connect.email")}</Label>
            <Input
              id="email-hub-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@gmail.com"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email-hub-password">{t("email_hub.connect.app_password")}</Label>
            <Input
              id="email-hub-password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <p className="text-caption text-muted-foreground">
            {t("email_hub.connect.hint")}{" "}
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-4 hover:text-brand"
              onClick={() => setGuideOpen(true)}
            >
              {t("email_hub.connect.guide.link")}
            </button>
          </p>
          {connectErrorKey ? (
            <p className="text-caption text-destructive">{t(connectErrorKey)}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!email || !password || connect.isPending} onClick={submit}>
            {t("email_hub.connect.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ConnectAppPasswordGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  );
}
