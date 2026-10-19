import { publicPage } from "../../platform/public-page";
import { seoMetadata } from "../../platform/seo";
export function generateMetadata() { return seoMetadata("/unichat"); }
export default function Page() { return publicPage("/unichat"); }
