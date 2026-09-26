import { SolutionsPage } from "../../features/landing/marketing-overview-pages";
import { marketingMetadata } from "../../platform/feature-metadata";

export function generateMetadata() { return marketingMetadata("solutions", "/solutions"); }
export default function Page() { return <SolutionsPage />; }
