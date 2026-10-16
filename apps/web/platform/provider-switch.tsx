"use client";
import "./runtime-config";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { SupportedLocale } from "@uniwork/core/i18n/types";
import { isMarketingPath } from "./marketing-routes";
import { MarketingProviders } from "./marketing-providers";

const ApplicationProviders = dynamic(() => import("./application-providers").then(module => module.ApplicationProviders));
export function ProviderSwitch(props: { initialLocale: SupportedLocale; initialDictionary?: object; children: React.ReactNode }) {
  return isMarketingPath(usePathname()) ? <MarketingProviders>{props.children}</MarketingProviders> : <ApplicationProviders {...props} />;
}
