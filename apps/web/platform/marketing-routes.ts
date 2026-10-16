import { marketingRoute } from "@uniwork/core/paths";

/** Public marketing sections: the landing and every page under these roots. */

/**
 * Pages that never read the session. The host skips the start-up refresh
 * there, so an anonymous visitor is not answered with a 401 on every load.
 */
export function isMarketingPath(pathname: string): boolean {
  return marketingRoute(pathname) !== null;
}
