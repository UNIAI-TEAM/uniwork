"use client";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import {
  completeOnboarding,
  mergeQuestionnaire,
  ONBOARDING_STEP_ORDER,
  saveQuestionnaire,
  setWelcomeSignal,
  type OnboardingStep,
  type QuestionnaireAnswers,
} from "@uniwork/core/onboarding";
import { useOrganizations } from "@uniwork/core/organizations";
import type { Organization, Workspace } from "@uniwork/core/types";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { toast } from "@uniwork/ui/components/ui/sonner";
import { OnboardingLogoutButton } from "./components/onboarding-logout-button";
import { StepShell } from "./components/step-shell";
import { StepAboutYou } from "./steps/step-about-you";
import { StepInvite } from "./steps/step-invite";
import { StepOrganization } from "./steps/step-organization";
import { StepWelcome } from "./steps/step-welcome";
import { StepWorkspace } from "./steps/step-workspace";

export type OnboardingMode = "first_run" | "new_workspace";

type PersistedStep = (typeof ONBOARDING_STEP_ORDER)[number];

/**
 * Orchestrator. Chỉ questionnaire persist qua server; bước đang đứng KHÔNG
 * persist — mỗi lần vào bắt đầu từ Welcome. Một StepShell duy nhất bao mọi
 * bước (hoisted) để rail không remount và không nháy fade mỗi lần chuyển bước.
 */
export function OnboardingFlow({
  onComplete,
  mode = "first_run",
  onCancel,
}: {
  onComplete: (workspace?: Workspace) => void;
  mode?: OnboardingMode;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useSession();
  if (!user) throw new Error("OnboardingFlow requires an authenticated user");
  const isNew = mode === "new_workspace";

  const [answers, setAnswers] = useState<QuestionnaireAnswers>(() => mergeQuestionnaire(user.onboarding_questionnaire ?? {}));
  const [step, setStep] = useState<OnboardingStep>(isNew ? "organization" : "welcome");
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [stepBusy, setStepBusy] = useState(false);

  const { data: workspaces = [], isFetched: wsFetched } = useWorkspaces();
  const { data: organizations = [] } = useOrganizations();
  const canSkipWelcome = wsFetched && workspaces.length > 0;
  // Resume: workspace đã có trong org đang chọn (lần trước bỏ dở).
  const existingInOrg = organization ? workspaces.filter((w) => w.organization_id === organization.id) : [];

  const next = useCallback((from: PersistedStep) => {
    const n = ONBOARDING_STEP_ORDER[ONBOARDING_STEP_ORDER.indexOf(from) + 1];
    if (n) setStep(n);
  }, []);

  const applyAnswers = useCallback(
    (patch: Partial<QuestionnaireAnswers>) => {
      setAnswers((a) => {
        const merged = { ...a, ...patch };
        void saveQuestionnaire(merged).catch(() => toast.error(t("onboarding.errors.save_failed")));
        return merged;
      });
    },
    [t],
  );

  const finish = useCallback(
    async (path: "full" | "invite_skipped") => {
      if (!workspace) return;
      try {
        await completeOnboarding(path, workspace.id);
      } catch {
        toast.error(t("onboarding.errors.complete_failed"));
        return;
      }
      setWelcomeSignal(workspace.id);
      onComplete(workspace);
    },
    [workspace, onComplete, t],
  );

  const skipWelcome = useCallback(async () => {
    const first = workspaces[0];
    try {
      await completeOnboarding("skip_existing", first?.id);
    } catch {
      toast.error(t("onboarding.errors.skip_failed"));
      return;
    }
    onComplete(first);
  }, [workspaces, onComplete, t]);

  const back = (from: PersistedStep) => {
    if (isNew && from === "organization") {
      onCancel?.();
      return;
    }
    const i = ONBOARDING_STEP_ORDER.indexOf(from);
    setStep(i <= 0 ? "welcome" : ONBOARDING_STEP_ORDER[i - 1]!);
  };

  if (step === "welcome") {
    return (
      <>
        <OnboardingLogoutButton />
        <StepWelcome onNext={() => setStep(ONBOARDING_STEP_ORDER[0]!)} onSkip={canSkipWelcome ? skipWelcome : undefined} />
      </>
    );
  }

  // Sau khi workspace tồn tại, bước Mời không có Back (quay lại sẽ tới bước
  // workspace mà back của nó = rời flow → workspace mồ côi không hướng dẫn).
  const stepBack =
    step === "about_you"
      ? () => back("about_you")
      : step === "organization"
        ? isNew && !onCancel
          ? undefined
          : () => back("organization")
        : step === "workspace"
          ? () => back("workspace")
          : undefined;
  // Rail chỉ đi lùi; new_workspace không có rail nav.
  const onStepChange = isNew ? undefined : (s: OnboardingStep) => setStep(s);

  return (
    <StepShell currentStep={step} onBack={stepBack} backDisabled={stepBusy} onStepChange={onStepChange} chromeFooter={<OnboardingLogoutButton inline />}>
      {step === "about_you" && (
        <StepAboutYou answers={answers} onChange={applyAnswers} onAdvance={() => next("about_you")} onSkip={() => next("about_you")} />
      )}
      {step === "organization" && (
        <StepOrganization
          organizations={organizations}
          selected={organization}
          onSelected={(o) => {
            setOrganization(o);
            next("organization");
          }}
          onBusyChange={setStepBusy}
        />
      )}
      {step === "workspace" && organization && (
        <StepWorkspace
          organization={organization}
          existing={existingInOrg}
          onCreated={(w) => {
            setWorkspace(w);
            next("workspace");
          }}
          onBusyChange={setStepBusy}
        />
      )}
      {step === "invite" && workspace && (
        <StepInvite workspace={workspace} onFinish={() => void finish("full")} onSkip={() => void finish("invite_skipped")} onBusyChange={setStepBusy} />
      )}
    </StepShell>
  );
}
