import { PricingPage } from "../../features/landing/marketing-overview-pages";
import { marketingMetadata } from "../../platform/feature-metadata";

export function generateMetadata() { return marketingMetadata("pricing", "/pricing"); }
export default function Page() { return <PricingPage />; }
