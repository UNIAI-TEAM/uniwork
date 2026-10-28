"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowRightLeft, ExternalLink, KeyRound, TriangleAlert, Unlink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { SignInMethods, SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import {
  useAuthProviders,
  useAuthStore,
  useDiscardSignInTicket,
  useLinkSignInTicket,
  useLogout,
  useSignInMethods,
  useStartSignInMethodLink,
  useUnlinkSignInMethod,
} from "@uniwork/core/auth";
import {
  LINK_RESULT_PARAMS,
  providerNameKey,
  readLinkResult,
  readSignInFailure,
  sentenceValues,
  type LinkResultNotice,
} from "@uniwork/core/auth/sign-in-errors";
import { emailDisplay, remainingAfterUnlink, unlinkVerdict } from "@uniwork/core/auth/sign-in-rules";
import { linkAction, unlinkAction } from "@uniwork/core/auth/step-up";
import { paths } from "@uniwork/core/paths";
import { getDesktopBridge } from "@uniwork/core/platform";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { webSignInProviders } from "../../auth/social-sign-in";
import { ConfirmDialog } from "../../common/form-dialog";
import { AppleMark, GoogleMark } from "../../common/provider-icons";
import { useNavigation } from "../../navigation";
import { PasswordDialog, type PasswordDialogMode } from "./security-password-dialog";
import {
  SettingsBadge,
  SettingsCard,
  SettingsList,
  SettingsListItem,
  SettingsLoadError,
  SettingsRowReason,
  SettingsSection,
} from "./settings-layout";
import { useStepUpGate } from "./step-up-proof";

/** The rows' 32px tile, shared with the skeleton so loading and loaded rows line up. */
const TILE = "flex size-8 items-center justify-center rounded-md";
const PROVIDERS = ["google", "apple"] as const;
const MARKS = { google: GoogleMark, apple: AppleMark };
const noopSubscribe = () => () => {};

/**
 * Settings › Sign-in methods (ADR 0047 §6, spec §4.5): the password, Google
 * and Apple, each with what it is now and the one thing to do about it.
 * Every change asks "Xác nhận là bạn" first unless a held token serves it
 * (step-up-proof.tsx). A provider the deployment does not offer has no row
 * unless the account is already linked to it. In the UniChat shell a link
 * goes through the browser — the provider's page needs one — so the row
 * opens this page there, and the list reads itself again when the window
 * comes back into focus; password and unlink run in place.
 */
export function SignInMethodsSection() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.security.signInMethods" });
  const { t: tRoot } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const methods = useSignInMethods();
  const providers = useAuthProviders();
  const bridge = useSyncExternalStore(noopSubscribe, getDesktopBridge, () => null);
  const nav = useNavigation();
  const gate = useStepUpGate();
  const startLink = useStartSignInMethodLink();
  const unlink = useUnlinkSignInMethod();
  const linkTicket = useLinkSignInTicket();
  const discardTicket = useDiscardSignInTicket();
  const [linking, setLinking] = useState<SignInProvider | null>(null);
  const [unlinking, setUnlinking] = useState<SignInProvider | null>(null);
  const [move, setMove] = useState<LinkResultNotice | null>(null);
  const [passwordMode, setPasswordMode] = useState<PasswordDialogMode>({ kind: "set", askCurrent: false });
  const [passwordOpen, setPasswordOpen] = useState(false);
  const handledResult = useRef<string | null>(null);
  const ids = useId();
  // The UniChat shell opened this page for its own account (`expect_user`)
  // and this browser is signed in to another: whatever is pressed here would
  // change that other account, so every change holds, pointing at the warning.
  const expected = nav.searchParams.get("expect_user");
  const otherAccount = Boolean(user && expected && expected !== user.id);
  const warningId = `${ids}-other-account`;
  const heldBy = otherAccount ? warningId : undefined;

  const providerName = (p: SignInProvider) => tRoot(providerNameKey(p));
  const say = (notice: { key: string; provider?: SignInProvider | null; values: { masked?: string } }) =>
    tRoot(notice.key, sentenceValues(notice, tRoot));
  const failed = (err: unknown) => toast.error(say(readSignInFailure(err, "methods")));

  // Back from a provider: say how the link ended, once, then take the result
  // off the URL so a reload or Back does not say it again. movable asks to
  // move the identity off the empty account that holds it.
  useEffect(() => {
    const result = readLinkResult(nav.searchParams);
    const query = nav.searchParams.toString();
    if (!result || handledResult.current === query) return;
    handledResult.current = query;
    if (result.tone === "confirm") setMove(result);
    else if (result.tone === "success") toast.success(say(result));
    else if (result.tone === "info") toast.info(say(result));
    else toast.error(say(result));
    const kept = new URLSearchParams(nav.searchParams);
    for (const name of LINK_RESULT_PARAMS) kept.delete(name);
    const rest = kept.toString();
    nav.replace(rest ? `${nav.pathname}?${rest}` : nav.pathname);
    // `say` is a fresh closure each render; the query is what decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav]);

  // The shell links in the browser: coming back to the window may mean a
  // new method.
  const refetch = methods.refetch;
  useEffect(() => bridge?.onFocusChange((focused) => void (focused && refetch())), [bridge, refetch]);

  const linkProvider = (p: SignInProvider) => {
    if (bridge) {
      if (user) void bridge.openExternal(runtimeConfig().appUrl + paths.securitySettings({ expectUser: user.id }));
      return;
    }
    if (linking) return;
    void gate.run({
      action: linkAction(p),
      command: () => {
        setLinking(p);
        return startLink.mutateAsync({ provider: p, returnTo: `${nav.pathname}?tab=security` });
      },
      // The page leaves for the provider; "Đang mở …" stays until it has.
      onSuccess: (url) => nav.openExternal?.(url),
      onError: (err) => {
        setLinking(null);
        failed(err);
      },
    });
  };

  const askUnlink = async (p: SignInProvider) => {
    if (await gate.ensure(unlinkAction(p))) setUnlinking(p);
  };

  const confirmUnlink = () => {
    const p = unlinking;
    if (!p || unlink.isPending) return;
    void gate.run({
      action: unlinkAction(p),
      command: () => unlink.mutateAsync({ provider: p }),
      onSuccess: () => {
        setUnlinking(null);
        toast.success(t("unlink.toast", { provider: providerName(p) }));
      },
      onError: (err) => {
        setUnlinking(null);
        failed(err);
      },
      onCancel: () => setUnlinking(null),
    });
  };

  const confirmMove = () => {
    const pending = move;
    if (!pending || linkTicket.isPending) return;
    void gate.run({
      action: linkAction(pending.provider),
      // The session that started the link confirms it as it is (spec §3.7);
      // a proof is asked only if the server wants one.
      upfront: false,
      command: () => linkTicket.mutateAsync({ provider: pending.provider, move: true }),
      onSuccess: () => {
        setMove(null);
        toast.success(t("move.toast", { provider: providerName(pending.provider) }));
      },
      onError: (err) => {
        setMove(null);
        failed(err);
      },
      onCancel: () => setMove(null),
    });
  };

  // "Không chuyển": the pending identity is dropped rather than left in a cookie.
  const declineMove = () => {
    if (linkTicket.isPending) return;
    setMove(null);
    discardTicket.mutate();
  };

  const openPassword = (data: SignInMethods) => {
    const mfaOn = data.proofs.includes("totp") || Boolean(user?.mfa_enabled_at);
    setPasswordMode({ kind: data.password.set ? "change" : "set", askCurrent: data.password.set && !mfaOn });
    setPasswordOpen(true);
  };

  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  // A date the server drifted on drops out of the line rather than throwing.
  const day = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : dateFormat.format(d);
  };
  const address = (email: string | null | undefined, privateRelay = false) => {
    const shown = emailDisplay(email, { privateRelay });
    return shown.kind === "relay" ? tRoot("auth.apple.relayEmail") : shown.kind === "address" ? shown.email : "";
  };
  // The address and the date are both worth reading, so a row too narrow for
  // both (a phone) stacks them instead of cutting the date off behind the
  // list's ellipsis; each still truncates on its own.
  const line = (...parts: string[]): ReactNode => {
    const shown = parts.filter(Boolean);
    if (shown.length < 2) return shown[0] ?? "";
    return (
      <span className="@container block">
        <span className="flex flex-col @[26rem]:flex-row @[26rem]:gap-1">
          {shown.map((part, i) => (
            <span key={part} className={i === 0 ? "min-w-0 truncate" : "truncate @[26rem]:shrink-0"}>
              {i > 0 ? (
                <span aria-hidden className="hidden @[26rem]:inline">
                  {" · "}
                </span>
              ) : null}
              {part}
            </span>
          ))}
        </span>
      </span>
    );
  };

  const offered = webSignInProviders(providers.data);
  const data = methods.data;
  let body: ReactNode;
  if (methods.isPending || providers.isPending) {
    body = <MethodsSkeleton rows={providers.data ? 1 + offered.length : 3} />;
  } else if (methods.isError || !data) {
    // A list that cannot be read is said, never shown as "not set": offering
    // "Đặt mật khẩu" to an account that has one would be a lie.
    body = (
      <SettingsCard>
        <SettingsLoadError onRetry={() => void methods.refetch()}>{t("loadError")}</SettingsLoadError>
      </SettingsCard>
    );
  } else {
    const shownProviders = PROVIDERS.filter((p) => data[p].linked || offered.includes(p));
    body = (
      <SettingsList aria-label={t("title")}>
        <SettingsListItem
          leading={
            <span className={cn(TILE, "bg-muted text-muted-foreground")}>
              <KeyRound aria-hidden className="size-4" />
            </span>
          }
          title={t("password.name")}
          badge={
            <SettingsBadge tone={data.password.set ? "success" : "muted"}>
              {t(data.password.set ? "badge.set" : "badge.unset")}
            </SettingsBadge>
          }
          meta={
            data.password.set
              ? line(
                  address(user?.email, data.account_email_is_relay),
                  day(data.password.changed_at) ? t("password.changedOn", { date: day(data.password.changed_at) }) : "",
                ) || t("password.set")
              : t("password.unset")
          }
          actions={
            <Button
              type="button"
              variant={data.password.set ? "ghost" : "outline"}
              size="sm"
              aria-disabled={otherAccount || undefined}
              aria-describedby={heldBy}
              onClick={() => {
                if (!otherAccount) openPassword(data);
              }}
            >
              {t(data.password.set ? "password.changeAction" : "password.setAction")}
            </Button>
          }
        />
        {shownProviders.map((p) => {
          const row = data[p];
          const Mark = MARKS[p];
          const name = providerName(p);
          const verdict = unlinkVerdict(data, p);
          const reasonId = `${ids}-${p}-reason`;
          const held = row.linked && !verdict.allowed;
          const describedBy = heldBy ?? (held ? reasonId : undefined);
          const relayRow = p === "apple" && data.apple.private_relay;
          const busy = linking === p;
          return (
            <SettingsListItem
              key={p}
              leading={
                <span className={cn(TILE, "border border-border bg-background text-foreground")}>
                  <Mark className="size-4" />
                </span>
              }
              title={name}
              badge={row.linked ? <SettingsBadge tone="success">{t("badge.linked")}</SettingsBadge> : null}
              meta={
                row.linked
                  ? line(
                      address(row.email, relayRow),
                      day(row.linked_at) ? t("provider.linkedOn", { date: day(row.linked_at) }) : "",
                    ) || t("provider.linked")
                  : bridge
                    ? t("provider.linkOnWebHint", { provider: name })
                    : t("provider.notLinked", { provider: name })
              }
              reason={held && verdict.key ? <SettingsRowReason>{tRoot(verdict.key)}</SettingsRowReason> : null}
              reasonId={reasonId}
              actions={
                row.linked ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t("provider.unlinkAria", { provider: name })}
                    aria-disabled={held || otherAccount || undefined}
                    aria-describedby={describedBy}
                    onClick={() => {
                      if (!held && !otherAccount) void askUnlink(p);
                    }}
                  >
                    {t("provider.unlink")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={busy ? undefined : t(bridge ? "provider.linkOnWebAria" : "provider.linkAria", { provider: name })}
                    aria-busy={busy || undefined}
                    aria-disabled={(linking !== null && !busy) || otherAccount || undefined}
                    aria-describedby={heldBy}
                    onClick={() => {
                      if (!otherAccount) linkProvider(p);
                    }}
                  >
                    {busy ? <Spinner /> : bridge ? <ExternalLink aria-hidden /> : null}
                    {busy ? t("provider.linking", { provider: name }) : t(bridge ? "provider.linkOnWeb" : "provider.link")}
                  </Button>
                )
              }
            />
          );
        })}
      </SettingsList>
    );
  }

  const remaining = data && unlinking ? remainingAfterUnlink(data, unlinking).map((kind) => t(`method.${kind}`)) : [];
  const unlinkBody = unlinking
    ? [
        t("unlink.body", { provider: providerName(unlinking) }),
        remaining.length === 1
          ? t("unlink.remainingOne", { method: remaining[0] })
          : remaining.length > 1
            ? t("unlink.remainingTwo", { first: remaining[0], second: remaining[1] })
            : "",
        t("unlink.signsOutOthers"),
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  return (
    <SettingsSection title={t("title")} description={t("description")}>
      {otherAccount && user ? <OtherBrowserAccount id={warningId} email={user.email} /> : null}
      {body}
      {gate.dialog}
      <PasswordDialog mode={passwordMode} open={passwordOpen} onOpenChange={setPasswordOpen} />
      <ConfirmDialog
        open={unlinking !== null && !gate.asking}
        onOpenChange={(open) => {
          if (!open && !unlink.isPending) setUnlinking(null);
        }}
        title={unlinking ? t("unlink.title", { provider: providerName(unlinking) }) : ""}
        description={unlinkBody}
        confirmLabel={t("unlink.confirm")}
        icon={Unlink}
        pending={unlink.isPending}
        onConfirm={confirmUnlink}
      />
      <ConfirmDialog
        open={move !== null && !gate.asking}
        onOpenChange={(open) => {
          if (!open) declineMove();
        }}
        title={move ? t("move.title", { provider: providerName(move.provider) }) : ""}
        description={
          move
            ? move.maskedEmail
              ? t("move.body", { provider: providerName(move.provider), masked: move.maskedEmail })
              : t("move.bodyUnknown", { provider: providerName(move.provider) })
            : ""
        }
        confirmLabel={t("move.confirm")}
        cancelLabel={t("move.decline")}
        destructive={false}
        tone="warning"
        icon={ArrowRightLeft}
        pending={linkTicket.isPending}
        onConfirm={confirmMove}
      />
    </SettingsSection>
  );
}

/**
 * The UniChat shell opened this page to link a method (`expect_user`), and
 * this browser is signed in to another account: what is linked here would
 * join that one. Said before anything is pressed, with the way out; the
 * rows' actions hold and point here (`id`) until the accounts match.
 */
function OtherBrowserAccount({ id, email }: { id: string; email: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.security.signInMethods" });
  const nav = useNavigation();
  const logout = useLogout();
  const here = `${nav.pathname}?${nav.searchParams.toString()}`;
  return (
    // Part of what the page says from the start, not news: a note, read in its place.
    <Alert id={id} variant="warning" role="note">
      <TriangleAlert aria-hidden />
      <AlertTitle className="[overflow-wrap:anywhere]">{t("browserOtherAccount", { other: email })}</AlertTitle>
      <AlertDescription className="text-pretty">{t("browserOtherAccountHint")}</AlertDescription>
      <div className="col-start-2 mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-busy={logout.isPending || undefined}
          aria-disabled={logout.isPending || undefined}
          onClick={() => {
            if (logout.isPending) return;
            logout.mutate(undefined, { onSettled: () => nav.replace(paths.login({ next: here })) });
          }}
        >
          {logout.isPending ? <Spinner /> : null}
          {t("signOut")}
        </Button>
      </div>
    </Alert>
  );
}

/** Loading rows in the list's own shape: a square tile, a title and a meta line, an action. */
function MethodsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="divide-y divide-border rounded-xl border border-surface-border bg-surface" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        // SettingsListItem's own wrap: on a phone the action drops under the
        // text and the address and date stack, so the rows land at their height.
        <div key={i} className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2.5 sm:flex-nowrap">
          <Skeleton className={TILE} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-48 max-w-full" />
            <Skeleton className="h-3 w-32 max-w-full sm:hidden" />
          </div>
          <div className="flex w-full justify-end sm:w-auto">
            <Skeleton className="h-7 w-20 rounded-md pointer-coarse:h-11" />
          </div>
        </div>
      ))}
    </div>
  );
}
