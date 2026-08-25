export type Role = "engineer" | "manager" | "product" | "ops" | "sales" | "hr" | "student" | "other";
export type UseCase = "team_tasks" | "meetings" | "personal_tasks" | "project_tracking" | "other";
export type OnboardingStep = "welcome" | "about_you" | "organization" | "workspace" | "invite";
export type OnboardingCompletionPath = "full" | "invite_skipped" | "skip_existing" | "invite_accept";

export interface QuestionnaireAnswers {
  version: 1;
  role: Role | null;
  role_other: string;
  role_skipped: boolean;
  use_case: UseCase[];
  use_case_other: string;
  use_case_skipped: boolean;
}

export const EMPTY_QUESTIONNAIRE: QuestionnaireAnswers = {
  version: 1,
  role: null,
  role_other: "",
  role_skipped: false,
  use_case: [],
  use_case_other: "",
  use_case_skipped: false,
};

function toArray<T extends string>(v: unknown): T[] {
  if (Array.isArray(v)) return v.filter((x): x is T => typeof x === "string" && x.length > 0);
  if (typeof v === "string" && v.length > 0) return [v as T];
  return [];
}

/** Điền lại câu trả lời đã lưu; *_skipped luôn reset để lần này có thể trả lời. */
export function mergeQuestionnaire(raw: Record<string, unknown>): QuestionnaireAnswers {
  return {
    ...EMPTY_QUESTIONNAIRE,
    role: typeof raw.role === "string" ? (raw.role as Role) : null,
    role_other: typeof raw.role_other === "string" ? raw.role_other : "",
    use_case: toArray<UseCase>(raw.use_case),
    use_case_other: typeof raw.use_case_other === "string" ? raw.use_case_other : "",
  };
}
