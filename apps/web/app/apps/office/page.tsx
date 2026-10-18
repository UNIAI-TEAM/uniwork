import { publicPage } from "../../../platform/public-page";
import { seoMetadata } from "../../../platform/seo";
export function generateMetadata() { return seoMetadata("/apps/office"); }
export default function Page() { return publicPage("/apps/office"); }
