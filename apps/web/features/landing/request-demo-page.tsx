"use client";
import { useRef, useState, type FormEvent } from "react";
import { MarketingLink as Link } from "../../platform/marketing-link";
import { ArrowLeft, ArrowRight, Check, CircleCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DEMO_TEAM_SIZES, useCreateDemoRequest, type DemoRequestInput } from "@uniwork/core/demo-requests";
import { ApiError } from "@uniwork/core/api";
import { paths } from "@uniwork/core/paths";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { MarketingShell } from "./marketing-shell";
import { Container } from "./layout-primitives";
import "./request-demo.css";

export function RequestDemoPage() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "landing.demo" });
  const mutation = useCreateDemoRequest();
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const [receipt, setReceipt] = useState<{ id: string; email: string } | null>(null);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    const data = new FormData(event.currentTarget);
    const input: DemoRequestInput = {
      full_name: String(data.get("full_name") ?? "").trim(), work_email: String(data.get("work_email") ?? "").trim(),
      company_name: String(data.get("company_name") ?? "").trim(), team_size: String(data.get("team_size")) as DemoRequestInput["team_size"],
      message: String(data.get("message") ?? "").trim(), locale: i18n.language.startsWith("vi") ? "vi" : "en",
    };
    const body = JSON.stringify(input);
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    setError("");
    try {
      const result = await mutation.mutateAsync({ input, key: attempt.current.key });
      if (!result.request_id) { setError(t("error")); return; }
      setReceipt({ id: result.request_id, email: input.work_email });
    } catch (cause) {
      setError(t(cause instanceof ApiError && cause.status === 429 ? "rate_limit" : "error"));
    }
  }
  return <MarketingShell showClosing={false}>
    <Container className="demo-request-page">
      <Link className="demo-back" href={paths.root()}><ArrowLeft aria-hidden />{t("back")}</Link>
      <div className="demo-request-layout">
        <div className="demo-request-intro">
          <h1>{t("headline")}</h1>
          <p>{t("description")}</p>
          <ul>{["workflow", "product", "questions"].map(key => <li key={key}><Check aria-hidden /><span>{t(`benefits.${key}`)}</span></li>)}</ul>
        </div>
        <section className="demo-request-panel" aria-labelledby="demo-form-title">
          {receipt ? <div className="demo-request-success" role="status">
            <CircleCheck aria-hidden />
            <h2 id="demo-form-title">{t("success_title")}</h2>
            <p>{t("success_description", { email: receipt.email })}</p>
            <small>{t("receipt", { id: receipt.id })}</small>
            <Link className={buttonVariants({ variant: "brand", size: "lg" })} href={paths.root()}>{t("back")}</Link>
          </div> : <>
            <h2 id="demo-form-title">{t("title")}</h2><p>{t("form_description")}</p>
            <form onSubmit={event => { void submit(event); }} className="demo-request-form" aria-busy={mutation.isPending}>
              <fieldset disabled={mutation.isPending}>
                <div><Label htmlFor="demo-name">{t("name")}</Label><Input id="demo-name" name="full_name" autoComplete="name" required maxLength={120} /></div>
                <div><Label htmlFor="demo-email">{t("email")}</Label><Input id="demo-email" name="work_email" type="email" autoComplete="email" required maxLength={254} /></div>
                <div><Label htmlFor="demo-company">{t("company")}</Label><Input id="demo-company" name="company_name" autoComplete="organization" required maxLength={160} /></div>
                <div><Label htmlFor="demo-size">{t("team_size")}</Label><Select name="team_size" required items={DEMO_TEAM_SIZES.map(value => ({ value, label: t("people", { size: value }) }))}><SelectTrigger id="demo-size" className="w-full"><SelectValue placeholder={t("choose_size")} /></SelectTrigger><SelectContent>{DEMO_TEAM_SIZES.map(size => <SelectItem key={size} value={size}>{t("people", { size })}</SelectItem>)}</SelectContent></Select></div>
                <div className="demo-form-message"><Label htmlFor="demo-message">{t("message")}</Label><Textarea id="demo-message" name="message" rows={3} maxLength={2000} placeholder={t("message_placeholder")} /></div>
              </fieldset>
              {error && <p className="demo-form-error" role="alert">{error}</p>}
              <Button variant="brand" size="lg" type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? <Spinner aria-hidden aria-label={undefined} role="presentation" /> : <ArrowRight aria-hidden />}
                {t(mutation.isPending ? "submitting" : "submit")}
              </Button>
              <p className="demo-form-privacy">{t("privacy")}</p>
            </form>
          </>}
        </section>
      </div>
    </Container>
  </MarketingShell>;
}
