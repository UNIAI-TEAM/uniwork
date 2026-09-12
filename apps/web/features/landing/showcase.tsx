"use client";
import { Bell, Check, Sparkles, UsersRound } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Kbd } from "@uniwork/ui/components/ui/kbd";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@uniwork/ui/components/ui/tabs";
import { cn } from "@uniwork/ui/lib/utils";
import { gsap, useGSAP } from "./animation/register-gsap";
import { revealFrom, withMotionPreference } from "./animation/reveal";
import { Container, SectionTitle } from "./layout-primitives";

/**
 * Three capabilities that shipped after the page was last written and that no
 * band covers: Ask UNI, the notification inbox, and the people directory.
 *
 * They share a section rather than taking three of their own for one reason:
 * none of them has a photograph, and three consecutive image-less bands would
 * be the same empty column three times. A tab strip also puts the reader in
 * charge of which one they read, which is the honest shape for three things
 * that do not rank against each other.
 *
 * The keyboard hint is a real one. Ask UNI opens on the same chord in the
 * product (packages/core shortcuts, F-09), so it is a fact about the software
 * rather than a decoration.
 */
const PANELS = [
  {
    value: "askuni",
    icon: Sparkles,
    ns: "landing.askuni",
    ink: "text-brand",
    tint: "bg-brand/5",
    chord: true,
  },
  { value: "inbox", icon: Bell, ns: "landing.inbox", ink: "text-warning", tint: "bg-warning/5" },
  { value: "people", icon: UsersRound, ns: "landing.people", ink: "text-brand-accent", tint: "bg-brand-accent/5" },
] as const;

const POINTS = ["point1", "point2", "point3"] as const;

export function Showcase() {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useGSAP(
    () =>
      withMotionPreference(root.current, (motion) => {
        const parts = body.current ? Array.from(body.current.children) : [];
        if (!motion || !root.current) {
          gsap.set(parts, { clearProps: "all" });
          return;
        }
        revealFrom(parts, root.current, 0.08);
      }),
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="landing-showcase-title" className="bg-surface py-24 sm:py-32">
      <Container ref={body}>
        <div className="max-w-3xl">
          <SectionTitle className="mt-0">
            <span id="landing-showcase-title">{t("landing.showcase.title")}</span>
          </SectionTitle>
          <p className="mt-4 max-w-prose text-title-sm text-pretty text-muted-foreground">{t("landing.showcase.sub")}</p>
        </div>

        <Tabs defaultValue={PANELS[0].value} className="mt-10 gap-8">
          <TabsList className="h-auto flex-wrap justify-start gap-2 bg-transparent p-0">
            {PANELS.map((panel) => (
              <TabsTrigger
                key={panel.value}
                value={panel.value}
                className="gap-2 rounded-full border border-border px-4 py-2 text-body font-medium data-[state=active]:border-brand data-[state=active]:bg-brand/10"
              >
                <panel.icon className={cn("size-4", panel.ink)} />
                {t(`${panel.ns}.tab`)}
              </TabsTrigger>
            ))}
          </TabsList>

          {PANELS.map((panel) => (
            <TabsContent key={panel.value} value={panel.value}>
              <div
                className={cn(
                  "grid gap-10 rounded-xl p-8 sm:p-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16",
                  panel.tint,
                )}
              >
                <div>
                  <panel.icon className={cn("size-8", panel.ink)} />
                  <h3 className="mt-6 font-heading text-display-sm font-bold leading-snug sm:text-display">
                    {t(`${panel.ns}.title`)}
                  </h3>
                  <p className="mt-4 max-w-prose text-title-sm leading-relaxed text-muted-foreground">
                    {t(`${panel.ns}.desc`)}
                  </p>
                  {"chord" in panel && panel.chord ? (
                    <p className="mt-6 flex items-center gap-2 text-body text-muted-foreground">
                      <Kbd>⌘</Kbd>
                      <Kbd>J</Kbd>
                    </p>
                  ) : null}
                </div>

                <ul className="grid content-start gap-4">
                  {POINTS.map((key) => (
                    <li key={key} className="flex items-start gap-3 rounded-lg bg-surface p-4 text-body-lg">
                      <span className={cn("mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-background", panel.ink)}>
                        <Check className="size-3.5" />
                      </span>
                      {t(`${panel.ns}.${key}`)}
                    </li>
                  ))}
                </ul>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </Container>
    </section>
  );
}
