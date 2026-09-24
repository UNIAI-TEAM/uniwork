import { marketingMetadata } from "../../platform/feature-metadata";
import { FeaturesPage } from "../../features/landing/feature-page";

export function generateMetadata() { return marketingMetadata("directory", "/features"); }
export default function Page() { return <FeaturesPage />; }
