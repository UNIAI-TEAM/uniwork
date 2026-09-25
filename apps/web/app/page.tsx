import { LandingPage } from "../features/landing/landing-page";
import { marketingMetadata } from "../platform/feature-metadata";

export function generateMetadata() { return marketingMetadata("home", "/"); }
export default function Page() { return <LandingPage />; }
