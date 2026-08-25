"use client";
import { useRouter } from "next/navigation";
import { LoginView } from "@uniwork/views/auth/login-view";

export default function LoginPage() {
  const router = useRouter();
  return <LoginView onSuccess={() => router.push("/workspaces")} />;
}
