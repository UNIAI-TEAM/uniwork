import { EnterprisePage } from "../../features/landing/marketing-overview-pages";
import { marketingMetadata } from "../../platform/feature-metadata";

export function generateMetadata() { return marketingMetadata("enterprise", "/enterprise"); } // plan-literal-ok: the /enterprise route
export default function Page() { return <EnterprisePage />; }
