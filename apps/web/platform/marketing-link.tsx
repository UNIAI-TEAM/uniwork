"use client";
import NextLink from "next/link";
import type { ComponentProps } from "react";
import { marketingHref, marketingRoute } from "@uniwork/core/paths";
import { persistMarketingLocale, useMarketingLocale } from "./marketing-context";

/** Auth transitions load the application provider independently of the marketing shell. */
export function MarketingLink({ href, prefetch = false, children, ...props }: ComponentProps<typeof NextLink>) {
  const locale = useMarketingLocale();
  const target = typeof href === "string" ? marketingHref(href, locale) : href;
  if (typeof target === "string" && target.startsWith("/") && !marketingRoute(target)) {
    return <a {...props} href={target} onClick={event => { props.onClick?.(event); if (!event.defaultPrevented) persistMarketingLocale(locale); }}>{children}</a>;
  }
  return <NextLink {...props} href={target} prefetch={prefetch}>{children}</NextLink>;
}

export function MarketingAnchor({ href, children, ...props }: ComponentProps<"a">) {
  const locale = useMarketingLocale();
  return <a {...props} href={href ? marketingHref(href, locale) : href}>{children}</a>;
}
