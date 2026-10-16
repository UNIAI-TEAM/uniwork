"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck } from "lucide-react";
import type { ConnectedApp } from "@uniwork/core/api/endpoints/connect";
import { useMyConnectedApps } from "@uniwork/core/connect";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button, ButtonLink } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../../common/form-dialog";
import { ConnectAssistantArt, type ArtKind } from "./connect-assistant-art";
import { CopyAddress } from "./copy-address";

type Assistant = "claude" | "chatgpt";

/** Where each assistant keeps its connections, and which words describe it. */
const ASSISTANTS: Record<
  Assistant,
  { href: string; open: string; add: string; artOpen: ArtKind; artAdd: ArtKind; use: string; mobile: string }
> = {
  claude: {
    href: "https://claude.ai/customize/connectors",
    open: "openClaude",
    add: "addClaude",
    artOpen: "openClaude",
    artAdd: "addClaude",
    use: "useClaude",
    mobile: "mobileClaude",
  },
  // ChatGPT moves its settings often; the home page is the one address that stays.
  chatgpt: {
    href: "https://chatgpt.com/",
    open: "openChatgpt",
    add: "addChatgpt",
    artOpen: "openChatgpt",
    artAdd: "addChatgpt",
    use: "useChatgpt",
    mobile: "mobileChatgpt",
  },
};

const TOTAL = 5;
const ALLOW = 5;
const POLL_MS = 3000;

function StepTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-body font-semibold">{children}</h3>;
}

/**
 * Connecting an assistant, one step at a time, for someone who has never
 * added a connector: pick the assistant, copy the address, open the
 * assistant, add UniWork, allow. The steps are words plus a drawing of where
 * to press, done side by side with the assistant open in another tab.
 *
 * The last step needs no button: while the dialog is open the list of
 * connected apps is re-read, and a grant that was not there when the guide
 * opened (`knownIds`) means it worked. A connection made before reaching the
 * last step counts too. Closing unmounts the steps, so the guide starts over.
 */
export function ConnectAssistantDialog({
  mcpUrl,
  knownIds,
  open,
  onOpenChange,
}: {
  mcpUrl: string;
  knownIds: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.connectedApps.guide" });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="lg">
        <FormDialogHeader title={t("title")} />
        <Steps mcpUrl={mcpUrl} knownIds={knownIds} onClose={() => onOpenChange(false)} />
      </FormDialogContent>
    </Dialog>
  );
}

function Steps({ mcpUrl, knownIds, onClose }: { mcpUrl: string; knownIds: readonly string[]; onClose: () => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.connectedApps.guide" });
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [step, setStep] = useState(1);
  const [checking, setChecking] = useState(false);
  const [notYet, setNotYet] = useState(false);
  const isNew = (g: ConnectedApp) => !knownIds.includes(g.id);
  const apps = useMyConnectedApps({
    refetchInterval: (q) => (q.state.data?.grants.some(isNew) ? false : POLL_MS),
  });
  const fresh = apps.data?.grants.find(isNew);
  const a = assistant ? ASSISTANTS[assistant] : null;
  const client = assistant ? t(assistant) : "";

  if (fresh) {
    return (
      <>
        <FormDialogBody>
          <div className="flex items-center gap-2">
            <CircleCheck aria-hidden className="size-5 text-success" />
            <StepTitle>{t("doneTitle", { client: fresh.client_name })}</StepTitle>
          </div>
          <p>{t("doneBody", { client: fresh.client_name })}</p>
          <p className="font-medium">{t("tryIt", { client: fresh.client_name })}</p>
          {a ? (
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>{t(a.use)}</li>
              <li>{t(a.mobile)}</li>
            </ul>
          ) : null}
        </FormDialogBody>
        <FormDialogFooter onCancel={onClose} cancelLabel={t("done")} />
      </>
    );
  }

  const back = (
    <Button
      type="button"
      variant="ghost"
      onClick={() => {
        setNotYet(false);
        setStep((s) => s - 1);
      }}
    >
      {t("back")}
    </Button>
  );
  const check = () => {
    setChecking(true);
    void apps.refetch().then((r) => {
      setChecking(false);
      setNotYet(!r.data?.grants.some(isNew));
    });
  };

  let body: ReactNode;
  if (step === 1 || !a) {
    body = (
      <>
        <StepTitle>{t("chooseTitle")}</StepTitle>
        <p className="text-muted-foreground">{t("chooseBody")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["claude", "chatgpt"] as const).map((key) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              className="h-auto flex-col items-start gap-0.5 p-4 text-left whitespace-normal"
              onClick={() => {
                setAssistant(key);
                setStep(2);
              }}
            >
              <span className="text-body font-semibold">{t(key)}</span>
              <span className="text-caption text-muted-foreground">{t(`${key}Hint`)}</span>
            </Button>
          ))}
        </div>
        <p className="text-caption text-muted-foreground">{t("other")}</p>
      </>
    );
  } else if (step === 2) {
    body = (
      <>
        {assistant === "chatgpt" ? (
          <Alert variant="warning">
            <AlertDescription>{t("chatgptWarning")}</AlertDescription>
          </Alert>
        ) : null}
        <StepTitle>{t("copyTitle")}</StepTitle>
        <p>{t("copyBody", { client })}</p>
        <div className="rounded-lg border border-border">
          <CopyAddress value={mcpUrl} />
        </div>
      </>
    );
  } else if (step === 3) {
    body = (
      <>
        <StepTitle>{t("openTitle", { client })}</StepTitle>
        <ConnectAssistantArt kind={a.artOpen} client={client} />
        <p>{t(a.open)}</p>
        <ButtonLink href={a.href} target="_blank" rel="noopener noreferrer" variant="outline">
          {t("openButton", { client })}
        </ButtonLink>
        <p className="text-caption text-muted-foreground">{t("openNote")}</p>
      </>
    );
  } else if (step === 4) {
    body = (
      <>
        <StepTitle>{t("addTitle", { client })}</StepTitle>
        <ConnectAssistantArt kind={a.artAdd} client={client} />
        <p>{t(a.add)}</p>
      </>
    );
  } else {
    body = (
      <>
        <StepTitle>{t("allowTitle")}</StepTitle>
        <ConnectAssistantArt kind="allow" client={client} />
        <p>{t("allowBody", { client })}</p>
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <Spinner aria-hidden />
          {t("waiting", { client })}
        </p>
        {notYet ? (
          <Alert variant="warning">
            <AlertDescription>{t("notYet", { client })}</AlertDescription>
          </Alert>
        ) : null}
      </>
    );
  }

  const first = step === 1 || !a;
  return (
    <>
      <FormDialogBody>
        <p className="text-caption text-muted-foreground">{t("step", { n: first ? 1 : step, total: TOTAL })}</p>
        {body}
      </FormDialogBody>
      <FormDialogFooter
        onCancel={onClose}
        cancelLabel={t("later")}
        leading={first ? undefined : back}
        submitLabel={first ? undefined : step === ALLOW ? t("check") : t("next")}
        submitting={checking}
        onSubmit={step === ALLOW ? check : () => setStep((s) => s + 1)}
      />
    </>
  );
}
