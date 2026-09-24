import { marketingMetadata } from "../../platform/feature-metadata";
import { SolutionsPage } from "../../features/landing/marketing-overview-pages";

export function generateMetadata() { return marketingMetadata("solutions", "/solutions"); }
export default function Page() { return <SolutionsPage />; }
