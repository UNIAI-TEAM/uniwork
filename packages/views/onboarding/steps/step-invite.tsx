"use client";
import { LayoutDashboard, LogIn, Mail } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Workspace } from "@uniwork/core/types";
import { useInvite } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@uniwork/ui/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { toastApiError } from "../../toast-api-error";
import { EMAIL_RE, EmailChipsInput } from "../../workspace/email-chips-input";
import { InviteRow, type SentInvite } from "../../workspace/invite-row";
import { StepFooter, StepHeading, STEP_HINT_ID } from "../components/step-shell";

/**
 * One line of the "what the invited person sees" panel.
 *
 * All three glyphs are `text-muted-foreground` on purpose. An earlier version
 * tinted them per line (blue/violet/green) and argued the colour identified a
 * module. It does not: `layout/module-tones.ts` binds violet to *meetings*, and
 * "joining a workspace" identifies no module at all, so that tint was pure
 * decoration — PRODUCT.md > Design Principles 3 forbids exactly that. Worse,
 * `--tint-green-foreground` and `--success` are the same hex in both themes, so
 * the green glyph was pixel-identical to the "đã gửi" success check that
 * replaces this panel in the very same box, implying a state the panel has not
 * reached. The words carry the meaning; neutral glyphs cost the panel nothing.
 */
function PreviewLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden className="mt-px flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <span className="text-body text-muted-foreground">{children}</span>
    </li>
  );
}

/**
 * Bước 4 — Mời đồng nghiệp. Gửi từng đợt (chip email + vai trò), hiện link mời
 * để copy. Hoàn tất chỉ mở khi đã gửi ≥1; Bỏ qua luôn có.
 *
 * Bố cục: ô email là chủ ngữ và chiếm trọn bề rộng; vai trò và nút Gửi nằm
 * chung MỘT hàng bên dưới. Bản cũ xếp ba hộp full-width bằng nhau nên nút Gửi
 * trông y như một ô nhập nữa, và không có gì nói cái nào quan trọng hơn cái nào.
 *
 * Nửa dưới không bao giờ trống: trước khi gửi nó trả lời câu hỏi duy nhất khiến
 * người ta chần chừ ở bước này — "đồng nghiệp tôi sẽ nhận được cái gì?" — rồi
 * nhường chỗ cho danh sách đã gửi. Bản cũ để trống ~380px ở 1440px.
 */
export function StepInvite({
  workspace,
  onFinish,
  onSkip,
  onBusyChange,
}: {
  workspace: Workspace;
  onFinish: () => void;
  onSkip: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const invite = useInvite(workspace.id);
  const [emails, setEmails] = useState<string[]>([]);
  const [role, setRole] = useState<"member" | "admin">("member");
  const [sent, setSent] = useState<SentInvite[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  // True once a batch went out while malformed chips were still in the box.
  // Paired with the live `invalidCount` below so the note disappears by itself
  // as soon as the user fixes or deletes the last malformed address.
  const [keptAfterSend, setKeptAfterSend] = useState(false);
  const valid = emails.filter((e) => EMAIL_RE.test(e));
  const invalidCount = emails.length - valid.length;
  const keptInvalid = keptAfterSend && invalidCount > 0;
  const busy = invite.isPending;
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  const send = () => {
    if (!valid.length || busy) return;
    const batch = valid;
    invite.mutate(
      { emails: batch, role },
      {
        onSuccess: (d) => {
          setSent((s) => [...s, ...d.invitations.map((i) => ({ email: i.email }))]);
          setSkipped(d.skipped);
          // Clear ONLY what was actually sent. `setEmails([])` used to wipe the
          // malformed chips too: the box had just told the user "sửa hoặc xoá
          // trước khi gửi", Send fired anyway, and the address that was never
          // sent vanished with no trace — `skipped_note` reports what the SERVER
          // skipped, and a client-side-invalid address never reaches the server,
          // so it appears nowhere. A teammate silently missed the invitation.
          //
          // Retention rather than gating Send on zero invalid chips: one typo in
          // a pasted list would otherwise block the two good addresses with no
          // way forward except deleting the evidence of the typo. Sending the
          // valid ones and keeping the rest in place loses nothing, and the
          // hint below says out loud that they stayed behind.
          const isSent = new Set(batch);
          setEmails((cur) => cur.filter((e) => !isSent.has(e)));
          setKeptAfterSend(batch.length < emails.length);
        },
        onError: (err) => toastApiError(err, t("onboarding.step_invite.send_failed")),
      },
    );
  };
  // The malformed-addresses-stayed note rides the footer hint rather than a live
  // region of its own: the hint is already this step's single `role="status"`
  // (see `StepFooter`), so folding the sentence in keeps one announcement per
  // action instead of two firing on the same click.
  const hint = keptInvalid
    ? t("workspace.invite_invalid_kept")
    : sent.length
      ? t("onboarding.step_invite.hint_done")
      : valid.length
        ? t("onboarding.step_invite.hint_ready", { count: valid.length })
        : t("onboarding.step_invite.hint_empty");

  return (
    <>
      <div className="flex flex-col gap-8 pt-2 sm:pt-6">
        <StepHeading title={t("onboarding.step_invite.headline", { workspace: workspace.name })} description={t("onboarding.step_invite.lede")} />
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="invite-emails">{t("onboarding.step_invite.emails_label")}</FieldLabel>
            <EmailChipsInput id="invite-emails" value={emails} onChange={setEmails} disabled={busy} placeholder={t("workspace.inviteHint")} />
          </Field>
          {/* Vai trò và Gửi chung một hàng: vai trò là quyết định phụ, mặc định
              đã đúng cho hầu hết trường hợp, nên nó không đáng một hộp riêng
              rộng bằng ô email. Ở màn hẹp hàng này xếp dọc trở lại.

              The role control is NOT a `<Field>`. `e2e/onboarding-shell.spec.ts`
              measures every `[data-slot="field"]` against the onboarding column
              and fails on anything narrower by more than 1px — that guard exists
              so a form cannot quietly give itself a narrower max-width — and a
              `<Field className="sm:w-44">` rendered at 176px in a 448px column,
              failing the spec. The label/select pair is composed directly here
              instead; `htmlFor`/`id` keep the association the Field gave us. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex w-full flex-col gap-2.5 sm:w-44">
              <FieldLabel htmlFor="invite-role">{t("onboarding.step_invite.role_label")}</FieldLabel>
              <Select
                value={role}
                onValueChange={(v) => setRole((v as "member" | "admin") ?? "member")}
                items={[
                  { value: "member", label: t("onboarding.step_invite.role_member") },
                  { value: "admin", label: t("onboarding.step_invite.role_admin") },
                ]}
              >
                {/* `min-h-10`, not `h-10`: SelectTrigger sizes itself with
                    `data-[size=…]:h-8`, an attribute selector that outranks any
                    plain height utility from a call site — `h-10` here was dead
                    and the control rendered 32px beside a 40px email field.
                    `min-height` wins over `height` at any specificity, which is
                    the escape hatch the primitive's own comment points at. */}
                <SelectTrigger id="invite-role" className="min-h-10 w-full pointer-coarse:min-h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">{t("onboarding.step_invite.role_member")}</SelectItem>
                  <SelectItem value="admin">{t("onboarding.step_invite.role_admin")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* `sm:ml-auto sm:w-auto`, never `flex-1`. Stretched to fill the row
                the button ran wall-to-wall from the select to the column edge,
                which did two things wrong: it made the send action the widest
                control on the screen — wider than the email field it acts on —
                and it left no gap, so the "Vai trò" label above the row read as
                the heading for BOTH controls. The gap is what scopes the label
                to the select alone. `min-h-10` matches the email field's 40px;
                `size="lg"` is h-9, and a plain height utility would lose to it. */}
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="min-h-10 w-full pointer-coarse:min-h-11 sm:ml-auto sm:w-auto"
              aria-disabled={!valid.length || busy || undefined}
              aria-describedby={STEP_HINT_ID}
              onClick={send}
            >
              {busy ? t("onboarding.step_invite.sending") : t("onboarding.step_invite.send")}
            </Button>
          </div>

          {/* A floor, not a transition: the empty-state panel is ~150px tall and
              a one-row sent list ~110px, so the swap used to pull the footer
              buttons ~40px up the instant the user clicked Send — right under
              the pointer. Reserving the taller of the two heights holds the
              footer still. No animation: the repo's motion budget is for motion
              that explains something, and the click already explains this. */}
          <div className="min-h-[9.5rem]">
            {sent.length > 0 ? (
              <Field>
                {/* Same element and same size as the empty-state panel's title
                    (`<h2 class="text-label">`). This used to be a `FieldTitle`,
                    which renders a `<div>` at `text-body`: navigating by heading
                    lost the landmark the moment the first batch went out, and
                    the type size changed in the same screen position for no
                    reason. `aria-labelledby` — not `<label for>` — because the
                    target is a <ul>, which is not a labelable element. */}
                <h2 id="invite-list-title" className="text-label font-medium text-foreground">
                  {t("onboarding.step_invite.sent_title", { count: sent.length })}
                </h2>
                <FieldDescription>{t("onboarding.step_invite.sent_hint")}</FieldDescription>
                <ul aria-labelledby="invite-list-title" className="flex flex-col gap-2">
                  {sent.map((s) => (
                    <InviteRow key={s.email} sent={s} />
                  ))}
                </ul>
                {skipped.length > 0 && <FieldDescription>{t("onboarding.step_invite.skipped_note", { count: skipped.length })}</FieldDescription>}
              </Field>
            ) : (
              <section className="rounded-xl border border-border bg-surface p-4">
                <h2 className="text-label font-medium text-foreground">{t("onboarding.step_invite.preview_title")}</h2>
                <ul className="mt-3 flex flex-col gap-2.5">
                  <PreviewLine icon={<Mail />}>{t("onboarding.step_invite.preview_mail")}</PreviewLine>
                  <PreviewLine icon={<LogIn />}>{t("onboarding.step_invite.preview_join")}</PreviewLine>
                  <PreviewLine icon={<LayoutDashboard />}>{t("onboarding.step_invite.preview_board")}</PreviewLine>
                </ul>
              </section>
            )}
          </div>
        </FieldGroup>
      </div>
      {/* Stacked, full-width footer buttons — the shape `step-about-you.tsx`,
          `step-organization.tsx` and `step-workspace.tsx` all use. This step was
          briefly a `sm:flex-row-reverse` row, which made the same two buttons
          look like a different control on the last step of the same flow. */}
      <StepFooter hint={hint}>
        <Button size="lg" className="w-full" aria-disabled={!sent.length || busy || undefined} aria-describedby={STEP_HINT_ID} onClick={onFinish}>
          {t("onboarding.step_invite.finish")}
        </Button>
        <Button size="lg" variant="ghost" className="w-full" aria-disabled={busy || undefined} onClick={onSkip}>
          {t("onboarding.step_invite.skip")}
        </Button>
      </StepFooter>
    </>
  );
}
