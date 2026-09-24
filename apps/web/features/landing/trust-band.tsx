"use client";
import { Waypoints } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Container } from "./layout-primitives";
import { PROVIDER_MARKS, type ProviderMarkKey } from "./provider-marks.generated";

const MODELS = [{ mark: "anthropic", label: "Anthropic" }, { mark: "openai", label: "OpenAI" }, { mark: "ollama", label: "landing.trust.modelSelfHosted" }] as const satisfies readonly { mark: ProviderMarkKey; label: string }[];

/** Provider marks are vendored originals, not customer endorsements. */
export function TrustBand() {
  const { t } = useTranslation();
  return (
    <section className="trust-band" aria-label={t("landing.trust.modelsLabel")}>
      <Container>
        <div className="trust-models">
          <div className="trust-model-heading">
            <span className="trust-model-signal" aria-hidden><Waypoints /></span>
            <h2>{t("landing.trust.modelsLabel")}</h2>
          </div>
          <ul aria-label={t("landing.trust.modelsLabel")}>
            {MODELS.map(({ mark, label }) => (
              <li key={mark}>
                <span className="trust-provider-mark" aria-hidden>
                  <svg viewBox={PROVIDER_MARKS[mark].viewBox} focusable="false"><path d={PROVIDER_MARKS[mark].path} /></svg>
                </span>
                <strong>{label.startsWith("landing.") ? t(label) : label}</strong>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
