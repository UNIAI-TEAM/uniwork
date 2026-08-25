"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRegister } from "@uniwork/core/auth";
import { ApiError } from "@uniwork/core/api";
import type { SessionResponse } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { AuthCard } from "./auth-card";

export function RegisterView({ onSuccess }: { onSuccess: (sess: SessionResponse) => void }) {
  const { t } = useTranslation();
  const reg = useRegister();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const errorMsg =
    reg.error instanceof ApiError && reg.error.code === "conflict"
      ? t("auth.emailTaken")
      : reg.error
        ? t("common.error")
        : null;

  return (
    <AuthCard title={t("auth.register")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          reg.mutate({ email, password, displayName }, { onSuccess });
        }}
      >
        <div>
          <Label htmlFor="displayName">{t("auth.displayName")}</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input
            id="password"
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {errorMsg && <p className="text-[13px] text-danger">{errorMsg}</p>}
        <Button type="submit" className="w-full" disabled={reg.isPending}>
          {t("auth.register")}
        </Button>
        <p className="text-center text-[13px] text-secondary">
          {t("auth.hasAccount")}{" "}
          <a href="/login" className="text-brand hover:underline">
            {t("auth.login")}
          </a>
        </p>
      </form>
    </AuthCard>
  );
}
