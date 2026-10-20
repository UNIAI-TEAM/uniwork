import { publicPage } from "../../../platform/public-page";
import { seoMetadata } from "../../../platform/seo";
export function generateMetadata() { return seoMetadata("/apps/unichat"); }
export default function Page() { return publicPage("/apps/unichat"); }
