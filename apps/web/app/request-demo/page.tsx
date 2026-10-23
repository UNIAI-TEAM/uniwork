import { publicPage } from "../../platform/public-page";
import { seoMetadata } from "../../platform/seo";
export function generateMetadata() { return seoMetadata("/request-demo"); }
export default function Page() { return publicPage("/request-demo"); }
