import { WhyPage } from "../../features/landing/why-page";
import { whyMetadata } from "../../platform/feature-metadata";

export function generateMetadata() { return whyMetadata(); }
export default function Page() { return <WhyPage />; }
