import { marketingMetadata } from "../../platform/feature-metadata";
import { LearnPage } from "../../features/landing/marketing-overview-pages";

export function generateMetadata() { return marketingMetadata("learn", "/learn"); }
export default function Page() { return <LearnPage />; }
