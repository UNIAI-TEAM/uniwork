"use client";
import { useRouter } from "next/navigation";
import { RegisterView } from "@uniwork/views/auth/register-view";

export default function RegisterPage() {
  const router = useRouter();
  return <RegisterView onSuccess={() => router.push("/workspaces")} />;
}
