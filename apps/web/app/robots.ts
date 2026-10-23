import type { MetadataRoute } from "next";
import "../platform/runtime-config";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { robotsPolicy } from "../platform/seo";

export default function robots(): MetadataRoute.Robots {
  return robotsPolicy(runtimeConfig().appUrl);
}
