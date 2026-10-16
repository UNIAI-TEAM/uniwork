import { NextResponse, type NextRequest } from "next/server";
import { marketingRoute } from "@uniwork/core/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import "./runtime-config";
import { isSearchProduction, PRODUCTION_ORIGIN } from "./seo";
import { publicNotFound } from "./public-not-found";

/** URL locale is authoritative; discard any caller-supplied internal locale header. */
export function searchProxy(request: NextRequest) {
  // A self-hosted Next server can put its bind address in nextUrl. The original
  // Host header identifies the requested site; do not trust x-forwarded-host.
  const hostname = (request.headers.get("host") ?? request.nextUrl.host).toLowerCase().replace(/:\d+$/, "");
  if (hostname === "www.uniworkos.com") {
    const destination = new URL(request.nextUrl.pathname + request.nextUrl.search, PRODUCTION_ORIGIN);
    return NextResponse.redirect(destination, 308);
  }
  const route = marketingRoute(request.nextUrl.pathname);
  if (!route && /^\/(?:vi(?:\/|$)|features\/|learn\/|solutions\/)/.test(request.nextUrl.pathname)) {
    return publicNotFound(request.nextUrl.pathname.startsWith("/vi/") ? "vi" : "en");
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-uniwork-marketing-locale");
  if (route) requestHeaders.set("x-uniwork-marketing-locale", route.locale);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (!route || !isSearchProduction(runtimeConfig().appUrl) || hostname !== "uniworkos.com") response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
