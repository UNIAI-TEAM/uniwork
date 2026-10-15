import { paths } from "@uniwork/core/paths";
import type { FeaturePageKey } from "../features/landing/feature-page-catalog";
import { seoMetadata } from "./seo";
/** Legacy call sites share the same catalogued, URL-authoritative metadata. */
export const featureMetadata = (key: FeaturePageKey) => Promise.resolve(seoMetadata(paths.feature(key)));
export const marketingMetadata = (_key: string, path: string) => Promise.resolve(seoMetadata(path));
export const solutionMetadata = (key: "product" | "operations") => Promise.resolve(seoMetadata(`/solutions/${key}`));
export const whyMetadata = () => Promise.resolve(seoMetadata(paths.whyUniwork()));
