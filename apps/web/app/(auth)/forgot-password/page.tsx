"use client";
import { sanitizeNextUrl } from "@uniwork/core/paths";
import { ForgotPasswordView } from "@uniwork/views/auth/forgot-password-view";
import { useNavigation } from "@uniwork/views/navigation";

export default function ForgotPasswordPage() {
  const { searchParams } = useNavigation();
  return <ForgotPasswordView next={sanitizeNextUrl(searchParams.get("next"))} />;
}
