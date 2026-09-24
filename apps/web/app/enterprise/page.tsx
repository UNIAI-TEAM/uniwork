import { marketingMetadata } from "../../platform/feature-metadata";
import { EnterprisePage } from "../../features/landing/marketing-overview-pages";

export function generateMetadata() { return marketingMetadata("enterprise", "/enterprise"); }
export default function Page() { return <EnterprisePage />; }
