import { publicPage } from "../../platform/public-page";
import { seoMetadata } from "../../platform/seo";
export function generateMetadata() { return seoMetadata("/changelog"); }
export default function Page() { return publicPage("/changelog"); }
