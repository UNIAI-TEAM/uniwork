import { ChangelogPage } from "../../features/landing/changelog/page";
import { marketingMetadata } from "../../platform/feature-metadata";

export function generateMetadata() { return marketingMetadata("changelog", "/changelog"); }
export default function Page() { return <ChangelogPage />; }
