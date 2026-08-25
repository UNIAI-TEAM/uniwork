import type { OnboardingStep } from "./types";

/** Welcome cố ý không nằm đây — là intro sản phẩm, không phải tiến độ. */
export const ONBOARDING_STEP_ORDER: readonly Exclude<OnboardingStep, "welcome">[] = [
  "about_you",
  "organization",
  "workspace",
  "invite",
] as const;
