"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { appHost } from "@uniwork/core/config";
import { useCreateWorkspaceInOrg } from "@uniwork/core/organizations";
import type { Organization, Workspace } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "sonner";
import { StepFooter, StepHeading, STEP_HINT_ID } from "../components/step-shell";
import { SlugFields, useSlugForm } from "../slug-field";
import { RadioCardGroup } from "../components/option-card";
import { avatarInitial, classifyCreateFailure, CollapsibleCreateCard, focusSlugInput, PickerCard } from "./step-organization";

/**
 * Bước 3 — Workspace trong org đã chọn. `existing` = workspace user đã có trong
 * org này (lần trước bỏ dở) → card chọn lại thay vì tạo trùng slug.
 */
export function StepWorkspace({
  organization,
  existing,
  onCreated,
  onBusyChange,
}: {
  organization: Organization;
  existing: Workspace[];
  onCreated: (workspace: Workspace) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const host = appHost();
  const form = useSlugForm();
  const create = useCreateWorkspaceInOrg();
  const resume = existing.length > 0;
  const [pickedId, setPickedId] = useState<string | "create" | null>(null);
  const picked = existing.find((w) => w.id === pickedId) ?? null;

  const isCreating = create.isPending;
  useEffect(() => {
    onBusyChange?.(isCreating);
    // Clear khi unmount: tạo xong flow chuyển bước ngay, không thì shell kẹt khoá.
    return () => onBusyChange?.(false);
  }, [isCreating, onBusyChange]);

  const handleCreate = () => {
    if (!form.canSubmit || isCreating) return;
    create.mutate(
      { orgId: organization.id, name: form.name.trim(), slug: form.slug.trim() },
      {
        onSuccess: (workspace) => {
          if (workspace) {
            onCreated(workspace);
            return;
          }
          // Same shape of trap as the organization step:
          // `organizations.createWorkspace()` parses with a `null` fallback, so
          // a drifted payload RESOLVES with nothing. Doing nothing left the
          // user staring at a CTA that had flipped back from "Đang tạo…" with
          // no explanation, and the retry answered 409 about the workspace they
          // had just created. `useCreateWorkspaceInOrg` already invalidates
          // `workspaceKeys.list()` on the falsy branch, so the recovery path is
          // the refreshed list.
          toast.error(t("onboarding.step_workspace.create_failed_toast"));
        },
        onError: (err) => {
          // Branch on `ApiError.code`, never on `err.message` — the message is
          // the server's own hardcoded Vietnamese sentence and was rendered
          // verbatim to English-locale users.
          const failure = classifyCreateFailure(err);
          if (failure === "unknown") {
            toast.error(t("onboarding.step_workspace.create_failed_toast"));
            return;
          }
          // Inline only. The toast that used to double this up announced the
          // same conflict a second time through its own live region.
          form.setServerError(
            failure === "slug_taken"
              ? t("onboarding.step_workspace.slug_taken_error")
              : t("onboarding.step_workspace.slug_invalid_error"),
          );
          focusSlugInput("ws");
        },
      },
    );
  };

  const creatingActive = !resume || pickedId === "create";
  let hint: string;
  let label: string;
  let disabled: boolean;
  let onContinue: () => void;
  if (picked) {
    hint = t("onboarding.step_workspace.hint_opening", { name: picked.name });
    label = t("onboarding.step_workspace.cta_open", { name: picked.name });
    // Reachable while a create is in flight (the picker cards stay clickable),
    // so the Button below refuses to run `onContinue` while `disabled` rather
    // than being `aria-disabled` and firing anyway.
    disabled = isCreating;
    onContinue = () => onCreated(picked);
  } else if (creatingActive) {
    if (isCreating) {
      hint = t("onboarding.step_workspace.hint_creating_pending", {
        name: form.name.trim() || t("onboarding.step_workspace.hint_creating_fallback"),
      });
      label = t("onboarding.step_workspace.cta_creating");
      disabled = true;
      onContinue = () => {};
    } else if (form.canSubmit) {
      hint = t("onboarding.step_workspace.hint_creating", { name: form.name.trim() });
      label = t("onboarding.step_workspace.cta_create_named", { name: form.name.trim() });
      disabled = false;
      onContinue = handleCreate;
    } else {
      // A name with no [a-z0-9] — a CJK or emoji partner name — slugifies to
      // "", so the name field is visibly full while the footer asks for a name.
      hint = form.name.trim()
        ? t("onboarding.step_workspace.hint_slug_needed")
        : t("onboarding.step_workspace.hint_name_first");
      label = t("onboarding.step_workspace.cta_create_workspace");
      disabled = true;
      onContinue = () => {};
    }
  } else {
    hint = t("onboarding.step_workspace.hint_pick");
    label = t("common.continue");
    disabled = true;
    onContinue = () => {};
  }

  const fields = (
    <SlugFields
      idPrefix="ws"
      form={form}
      hostPrefix={`${host}/${organization.slug}/`}
      withRandom
      disabled={isCreating}
      nameLabel={t("onboarding.step_workspace.name_label")}
      namePlaceholder={t("onboarding.step_workspace.name_placeholder")}
      urlLabel={t("onboarding.step_workspace.url_label")}
      slugPlaceholder={t("onboarding.step_workspace.slug_placeholder")}
      onEnter={handleCreate}
      autoFocus={!resume || pickedId === "create"}
      preview={{
        title: t("onboarding.step_workspace.url_preview_label"),
        body: (
          <>
            {t("onboarding.step_workspace.url_preview_prefix")}
            <span className="font-mono text-foreground">
              {host}/{organization.slug}/{form.slug || "…"}
            </span>
            {t("onboarding.step_workspace.url_preview_suffix")}
          </>
        ),
      }}
    />
  );

  return (
    <>
      <div className="flex flex-col gap-8 pt-2 sm:pt-6">
        <StepHeading
          title={
            // Only name one workspace when there is exactly one; with three
            // equal cards below, naming the first is arbitrary.
            resume
              ? existing.length === 1
                ? t("onboarding.step_workspace.headline_resume", { name: existing[0]!.name })
                : t("onboarding.step_workspace.headline_resume_many")
              : t("onboarding.step_workspace.headline_first")
          }
          description={resume ? t("onboarding.step_workspace.lede_resume") : t("onboarding.step_workspace.lede_first")}
        />
        {resume ? (
          <RadioCardGroup label={t("onboarding.step_workspace.picker_label")} className="flex flex-col gap-3">
            {existing.map((w) => (
              <PickerCard
                key={w.id}
                selected={pickedId === w.id}
                onSelect={() => setPickedId((p) => (p === w.id ? null : w.id))}
                title={w.name}
                subtitle={`${host}/${organization.slug}/${w.slug}`}
                avatar={avatarInitial(w.name)}
              />
            ))}
            <CollapsibleCreateCard
              idPrefix="ws"
              selected={pickedId === "create"}
              onSelect={() => setPickedId((p) => (p === "create" ? null : "create"))}
              title={t("onboarding.step_workspace.create_new_title")}
              subtitle={t("onboarding.step_workspace.create_new_subtitle")}
            >
              {fields}
            </CollapsibleCreateCard>
          </RadioCardGroup>
        ) : (
          fields
        )}
      </div>
      <StepFooter hint={hint}>
        <Button
          size="lg"
          className="w-full"
          aria-disabled={disabled || undefined}
          aria-describedby={STEP_HINT_ID}
          onClick={() => {
            if (disabled) return;
            onContinue();
          }}
        >
          {label}
        </Button>
      </StepFooter>
    </>
  );
}
