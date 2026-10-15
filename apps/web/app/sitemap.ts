import type { MetadataRoute } from "next";
import "../platform/runtime-config";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { sitemapEntries } from "../platform/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries(runtimeConfig().appUrl);
}
