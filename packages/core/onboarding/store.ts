import * as auth from "../api/endpoints/auth";
import { ApiError } from "../api/http";
import { setSessionUser } from "../auth/hooks";
import type { OnboardingCompletionPath, QuestionnaireAnswers } from "./types";

export async function saveQuestionnaire(answers: QuestionnaireAnswers): Promise<void> {
  const user = await auth.patchOnboarding(answers);
  if (user) setSessionUser(user);
}

/**
 * The ONLY frontend path that moves `onboarded_at` from null to a value.
 * A drifted response here is surfaced rather than ignored: the caller is
 * about to navigate into the workspace on the strength of it.
 */
export async function completeOnboarding(
  path: OnboardingCompletionPath,
  workspaceId?: string,
): Promise<void> {
  const user = await auth.completeOnboarding(path, workspaceId);
  if (!user) throw new ApiError("Unexpected response from the server", "malformed_response", 502);
  setSessionUser(user);
}
