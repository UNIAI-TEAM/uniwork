import { LearnPage } from "../../features/landing/marketing-overview-pages";
import { marketingMetadata } from "../../platform/feature-metadata";

export function generateMetadata() { return marketingMetadata("learn", "/learn"); }
export default function Page() { return <LearnPage />; }
