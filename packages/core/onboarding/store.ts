import { z } from "zod";
import * as api from "../api/client";
import { setSessionUser } from "../auth/hooks";
import { UserSchema } from "../types";
import type { OnboardingCompletionPath, QuestionnaireAnswers } from "./types";

const UserResponse = z.object({ user: UserSchema });

export async function saveQuestionnaire(answers: QuestionnaireAnswers): Promise<void> {
  const d = await api.request("/api/v1/me/onboarding", {
    method: "PATCH",
    body: { questionnaire: answers },
    schema: UserResponse,
  });
  setSessionUser(d.user);
}

/** Cơ chế DUY NHẤT phía FE làm `onboarded_at` chuyển từ null → có giá trị. */
export async function completeOnboarding(
  path: OnboardingCompletionPath,
  workspaceId?: string,
): Promise<void> {
  const d = await api.request("/api/v1/me/onboarding/complete", {
    method: "POST",
    body: { completion_path: path, workspace_id: workspaceId },
    schema: UserResponse,
  });
  setSessionUser(d.user);
}
