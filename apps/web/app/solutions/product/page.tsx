import { SolutionPage } from "../../../features/landing/solution-page";
import { solutionMetadata } from "../../../platform/feature-metadata";

export function generateMetadata() { return solutionMetadata("product"); }
export default function Page() { return <SolutionPage solution="product" />; }
