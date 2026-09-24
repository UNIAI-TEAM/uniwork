import { marketingMetadata } from "../../platform/feature-metadata";
import { PricingPage } from "../../features/landing/marketing-overview-pages";

export function generateMetadata() { return marketingMetadata("pricing", "/pricing"); }
export default function Page() { return <PricingPage />; }
