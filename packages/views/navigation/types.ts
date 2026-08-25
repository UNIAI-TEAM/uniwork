/**
 * What a host platform must provide for shared screens to navigate. Web
 * implements it over next/navigation in apps/web/platform; a desktop or
 * mobile shell would implement it over its own router. Shared code never
 * imports a router — it asks this adapter.
 */
export interface NavigationAdapter {
  push(path: string): void;
  replace(path: string): void;
  back(): void;
  pathname: string;
  searchParams: URLSearchParams;
  /** A shareable absolute URL for a path. Web: origin + path. */
  getShareableUrl(path: string): string;
  /**
   * Optional: warm up route assets for a path. Web wires this to
   * router.prefetch; a host without the concept leaves it undefined and
   * callers invoke it as `prefetch?.(href)`.
   */
  prefetch?: (path: string) => void;
  /**
   * Optional: is there an in-app page behind the current one, so that back()
   * lands inside the app rather than stepping off it? Only the host can
   * answer; adapters that cannot leave it undefined and callers treat that
   * as false.
   */
  canGoBack?: () => boolean;
}
