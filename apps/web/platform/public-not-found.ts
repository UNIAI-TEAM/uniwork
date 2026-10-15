import { NextResponse } from "next/server";
import type { SupportedLocale } from "@uniwork/core/i18n/types";

/** Reject unknown public URLs before a streamed layout can commit a 200 response. */
export function publicNotFound(locale: SupportedLocale) {
  const title = locale === "vi" ? "Không tìm thấy trang" : "Page not found";
  const description = locale === "vi" ? "Đường dẫn này không tồn tại hoặc đã bị đổi." : "This address does not exist or has moved.";
  const home = locale === "vi" ? "Về trang chủ" : "Back to home";
  return new NextResponse(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · UniWork</title><style>:root{color-scheme:light dark;font-family:system-ui}body{margin:0}main{min-height:100dvh;display:grid;place-content:center;text-align:center;padding-inline:24px}a{color:LinkText}</style></head><body><main data-testid="app-not-found"><h1>${title}</h1><p>${description}</p><a href="${locale === "vi" ? "/vi" : "/"}">${home}</a></main></body></html>`, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" },
  });
}
