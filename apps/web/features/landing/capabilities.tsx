"use client";
import { useTranslation } from "react-i18next";
import { ANCHORS } from "./anchors";
import { Container } from "./layout-primitives";

import { ProductPreview } from "./product-preview";
import { PRODUCT_FEATURES } from "./showcase";

export function Capabilities() {
  const { t } = useTranslation();
  return (
    <section id={ANCHORS.platform} className="studio-section platform-section" aria-labelledby="platform-title">
      <Container>
        {PRODUCT_FEATURES.map(feature => <span className="workspace-anchor" key={feature.anchor} id={feature.anchor} aria-hidden />)}
        <h2 id="platform-title" className="sr-only">{t("landing.workspace.title")}</h2>
        <ProductPreview />
      </Container>
    </section>
  );
}
