"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
export function OnboardingFlow(props: {
  onComplete: (workspace?: Workspace) => void;
  mode?: OnboardingMode;
  onCancel?: () => void;
}) {
  const { user } = useSession();
  // Guard nằm ở component BỌC, không nằm giữa các hook.
  //
  // Trước đây thân hàm `throw` sau `useTranslation`/`useSession` nhưng trước
  // `useState`: đăng xuất giữa flow làm user về null, và lần render đó chạy ít
  // hook hơn lần trước → React báo "Rendered fewer hooks than expected" thay vì
  // một lỗi đọc được. Hôm nay cả hai call site đều chặn trước bằng
  // `status !== "authed"` nên chưa nổ, nhưng đó là may mắn về thứ tự render chứ
  // không phải thiết kế.
  if (!user) return null;
  return <AuthedOnboardingFlow {...props} user={user} />;
}

function AuthedOnboardingFlow({
  onComplete,
  mode = "first_run",
  onCancel,
  user,
}: {
  onComplete: (workspace?: Workspace) => void;
  mode?: OnboardingMode;
  onCancel?: () => void;
  user: NonNullable<ReturnType<typeof useSession>["user"]>;
}) {
  const { t } = useTranslation();
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

  // Nguồn sự thật để gộp patch nằm ngoài updater: gọi API bên trong hàm cập nhật
  // state là side effect trong pha render — StrictMode chạy updater hai lần nên
  // mỗi thay đổi thành hai lần PATCH.
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyAnswers = useCallback(
    (patch: Partial<QuestionnaireAnswers>) => {
      const merged = { ...answersRef.current, ...patch };
      answersRef.current = merged;
      setAnswers(merged);
      // Ô "Khác" gọi hàm này mỗi ký tự — gom lại thành một PATCH sau khi ngừng gõ.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveQuestionnaire(merged).catch(() => toast.error(t("onboarding.errors.save_failed")));
      }, 600);
    },
    [t],
  );

  // Rời bước khi còn PATCH đang chờ thì đẩy đi ngay, đừng bỏ mất câu trả lời.
  const flushAnswers = useCallback(() => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    void saveQuestionnaire(answersRef.current).catch(() => toast.error(t("onboarding.errors.save_failed")));
  }, [t]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

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
        <StepAboutYou
          answers={answers}
          onChange={applyAnswers}
          onAdvance={() => {
            flushAnswers();
            next("about_you");
          }}
          onSkip={() => {
            flushAnswers();
            next("about_you");
          }}
        />
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
