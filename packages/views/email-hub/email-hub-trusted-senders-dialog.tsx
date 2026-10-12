"use client";

import { Images, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useEmailHubTrustedSenders,
  useEmailHubTrustedSendersStore,
} from "@uniwork/core/email-hub/trusted-senders";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@uniwork/ui/components/ui/empty";
import { FormDialogBody, FormDialogContent, FormDialogHeader } from "../common/form-dialog";
import { EmailSenderAvatar } from "./email-hub-view-parts";

/** The senders of one mailbox whose images show without asking, each removable. */
export function EmailHubTrustedSendersDialog({
  accountId,
  open,
  onOpenChange,
}: {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const senders = useEmailHubTrustedSenders(accountId);
  const setTrusted = useEmailHubTrustedSendersStore((state) => state.setTrusted);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent>
        <FormDialogHeader
          title={t("email_hub.trusted_senders")}
          description={t("email_hub.trusted_senders_description")}
        />
        <FormDialogBody>
          {senders.length === 0 ? (
            <Empty className="py-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Images aria-hidden />
                </EmptyMedia>
                <EmptyTitle>{t("email_hub.trusted_senders_empty")}</EmptyTitle>
                <EmptyDescription className="text-caption">{t("email_hub.trusted_senders_empty_hint")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="divide-y divide-border">
              {senders.map((email) => (
                <li key={email} className="flex min-w-0 items-center gap-3 py-2">
                  <EmailSenderAvatar fromAddr={email} className="size-7 text-caption" />
                  <span className="min-w-0 flex-1 text-body [overflow-wrap:anywhere]">{email}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("email_hub.trusted_senders_remove", { email })}
                    onClick={() => setTrusted(accountId, email, false)}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </FormDialogBody>
      </FormDialogContent>
    </Dialog>
  );
}
