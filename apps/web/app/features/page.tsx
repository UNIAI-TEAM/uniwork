import { FeaturesPage } from "../../features/landing/feature-page";
import { marketingMetadata } from "../../platform/feature-metadata";

export function generateMetadata() { return marketingMetadata("features", "/features"); }
export default function Page() { return <FeaturesPage />; }
