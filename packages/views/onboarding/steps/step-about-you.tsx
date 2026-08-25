"use client";
import {
  Briefcase,
  Code2,
  GraduationCap,
  Handshake,
  KanbanSquare,
  ListChecks,
  MoreHorizontal,
  Settings2,
  User,
  UserRound,
  Users,
  Video,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { QuestionnaireAnswers, Role, UseCase } from "@uniwork/core/onboarding";
import { Button } from "@uniwork/ui/components/ui/button";
import { IconOptionCard, IconOtherOptionCard, type QuestionOption } from "../components/icon-option-card";
import { StepFooter, StepHeading, STEP_HINT_ID } from "../components/step-shell";

/**
 * Bước 1 — "Về bạn": vai trò (chọn một) + mục đích (chọn nhiều) trên MỘT màn.
 * Tiếp tục mở khi MỘT trong hai nhóm đã trả lời ("Khác" chỉ tính khi có chữ).
 * Nhóm bỏ trống khi Tiếp tục → đánh *_skipped. Bỏ qua → cả hai skipped.
 * Mọi thay đổi PATCH ngay qua onChange (flow fire-and-forget).
 */
export function StepAboutYou({
  answers,
  onChange,
  onAdvance,
  onSkip,
}: {
  answers: QuestionnaireAnswers;
  onChange: (patch: Partial<QuestionnaireAnswers>) => void;
  onAdvance: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const r = (k: string) => t(`onboarding.questions.role.${k}`);
  const u = (k: string) => t(`onboarding.questions.use_case.${k}`);

  const roleOptions: QuestionOption[] = [
    { slug: "engineer", icon: <Code2 />, label: r("engineer") },
    { slug: "manager", icon: <Users />, label: r("manager") },
    { slug: "product", icon: <Briefcase />, label: r("product") },
    { slug: "ops", icon: <Settings2 />, label: r("ops") },
    { slug: "sales", icon: <Handshake />, label: r("sales") },
    { slug: "hr", icon: <UserRound />, label: r("hr") },
    { slug: "student", icon: <GraduationCap />, label: r("student") },
    { slug: "other", icon: <MoreHorizontal />, label: r("other"), isOther: true },
  ];
  const useCaseOptions: QuestionOption[] = [
    { slug: "team_tasks", icon: <ListChecks />, label: u("team_tasks") },
    { slug: "meetings", icon: <Video />, label: u("meetings") },
    { slug: "personal_tasks", icon: <User />, label: u("personal_tasks") },
    { slug: "project_tracking", icon: <KanbanSquare />, label: u("project_tracking") },
    { slug: "other", icon: <MoreHorizontal />, label: u("other"), isOther: true },
  ];

  const roleSelected: readonly string[] = answers.role ? [answers.role] : [];
  const roleAnswered = answers.role !== null && (answers.role !== "other" || answers.role_other.trim().length > 0);
  const useCaseSlugs = answers.use_case;
  const useCaseAnswered =
    useCaseSlugs.length > 0 && (useCaseSlugs.some((s) => s !== "other") || answers.use_case_other.trim().length > 0);
  const canContinue = roleAnswered || useCaseAnswered;

  const pickRole = (slug: string) => {
    if (slug === "other") {
      onChange({ role: "other", role_skipped: false });
      return;
    }
    onChange({ role: slug as Role, role_other: "", role_skipped: false });
  };

  const toggleUseCase = (slug: string) => {
    const current = answers.use_case;
    if (slug === "other") {
      if (current.includes("other")) onChange({ use_case: current.filter((s) => s !== "other"), use_case_other: "" });
      else onChange({ use_case: [...current, "other"], use_case_skipped: false });
      return;
    }
    const typed = slug as UseCase;
    const next = current.includes(typed) ? current.filter((s) => s !== typed) : [...current, typed];
    onChange({ use_case: next, use_case_skipped: false });
  };

  const confirmAdvance = () => {
    if (!canContinue) return;
    const patch: Partial<QuestionnaireAnswers> = {};
    if (!roleAnswered) Object.assign(patch, { role: null, role_other: "", role_skipped: true });
    if (!useCaseAnswered) Object.assign(patch, { use_case: [], use_case_other: "", use_case_skipped: true });
    if (Object.keys(patch).length > 0) onChange(patch);
    onAdvance();
  };

  const handleSkip = () => {
    onChange({ role: null, role_other: "", role_skipped: true, use_case: [], use_case_other: "", use_case_skipped: true });
    onSkip();
  };

  return (
    <>
      <div className="flex flex-col gap-8 pt-2 sm:pt-6">
        <StepHeading title={t("onboarding.questions.about_you.question")} />
        <QuestionGroup
          name="onboarding-role"
          question={r("question")}
          options={roleOptions}
          selectedSlugs={roleSelected}
          otherValue={answers.role_other}
          onOtherChange={(v) => onChange({ role_other: v })}
          otherPlaceholder={r("other_placeholder")}
          onAnswer={pickRole}
          onConfirm={confirmAdvance}
        />
        <QuestionGroup
          name="onboarding-use-case"
          question={u("question")}
          options={useCaseOptions}
          selectedSlugs={useCaseSlugs}
          otherValue={answers.use_case_other}
          onOtherChange={(v) => onChange({ use_case_other: v })}
          otherPlaceholder={u("other_placeholder")}
          onAnswer={toggleUseCase}
          onConfirm={confirmAdvance}
          multiSelect
        />
      </div>
      <StepFooter hint={canContinue ? t("onboarding.step_question.hint_continue") : t("onboarding.step_question.hint_pick")}>
        {/* `aria-disabled` chứ không phải `disabled`: nút `disabled` rời khỏi thứ
            tự Tab, nên người dùng bàn phím không bao giờ tới được nó để nghe
            dòng hint giải thích còn thiếu gì. `confirmAdvance` vẫn tự chặn. */}
        <Button
          size="lg"
          className="w-full"
          aria-disabled={!canContinue || undefined}
          aria-describedby={STEP_HINT_ID}
          onClick={confirmAdvance}
        >
          {t("common.continue")}
        </Button>
        <Button size="lg" variant="ghost" className="w-full" onClick={handleSkip}>
          {t("common.skip")}
        </Button>
      </StepFooter>
    </>
  );
}

function QuestionGroup({
  name,
  question,
  options,
  selectedSlugs,
  otherValue,
  onOtherChange,
  otherPlaceholder,
  onAnswer,
  onConfirm,
  multiSelect = false,
}: {
  name: string;
  question: string;
  options: readonly QuestionOption[];
  selectedSlugs: readonly string[];
  otherValue: string;
  onOtherChange: (value: string) => void;
  otherPlaceholder: string;
  onAnswer: (slug: string) => void;
  onConfirm: () => void;
  multiSelect?: boolean;
}) {
  const otherOption = options.find((o) => o.isOther) ?? null;
  const otherSelected = otherOption ? selectedSlugs.includes(otherOption.slug) : false;
  const mode = multiSelect ? "checkbox" : "radio";
  // `<fieldset>` + `<legend>` là nhóm native: radio cùng `name` bên trong tự có
  // roving tabindex và phím mũi tên. Không cần role thủ công nữa.
  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
      <legend className="mb-0 p-0 text-label font-medium text-primary">{question}</legend>
      <div className="flex flex-row flex-wrap gap-2">
        {options.map((option) =>
          option.isOther ? (
            <IconOtherOptionCard
              key={option.slug}
              name={name}
              icon={option.icon}
              label={option.label}
              selected={otherSelected}
              onSelect={() => onAnswer(option.slug)}
              onDeselect={multiSelect ? () => onAnswer(option.slug) : undefined}
              otherValue={otherValue}
              onOtherChange={onOtherChange}
              onConfirm={onConfirm}
              placeholder={otherPlaceholder}
              mode={mode}
            />
          ) : (
            <IconOptionCard
              key={option.slug}
              name={name}
              icon={option.icon}
              label={option.label}
              selected={selectedSlugs.includes(option.slug)}
              onSelect={() => onAnswer(option.slug)}
              mode={mode}
            />
          ),
        )}
      </div>
    </fieldset>
  );
}
