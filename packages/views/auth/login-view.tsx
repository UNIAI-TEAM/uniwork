"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLogin } from "@uniwork/core/auth";
import { ApiError } from "@uniwork/core/api";
import type { SessionResponse } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { AuthCard } from "./auth-card";

export function LoginView({ onSuccess }: { onSuccess: (sess: SessionResponse) => void }) {
  const { t } = useTranslation();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const errorMsg =
    login.error instanceof ApiError && login.error.code === "invalid_credentials"
      ? t("auth.invalidCredentials")
      : login.error
        ? t("common.error")
        : null;

  return (
    <AuthCard title={t("auth.login")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate({ email, password }, { onSuccess });
        }}
      >
        <div>
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {errorMsg && <p className="text-label text-destructive">{errorMsg}</p>}
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {t("auth.login")}
        </Button>
        <p className="text-center text-label text-muted-foreground">
          {t("auth.noAccount")}{" "}
          <a href="/register" className="text-brand hover:underline">
            {t("auth.register")}
          </a>
        </p>
      </form>
    </AuthCard>
  );
}
