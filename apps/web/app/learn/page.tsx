import { publicPage } from "../../platform/public-page";
import { seoMetadata } from "../../platform/seo";
export function generateMetadata() { return seoMetadata("/learn"); }
export default function Page() { return publicPage("/learn"); }
