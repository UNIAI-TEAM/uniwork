import { OfficePage } from "../../features/landing/office-page";
import { marketingMetadata } from "../../platform/feature-metadata";

export function generateMetadata() { return marketingMetadata("office", "/office"); }
export default function Page() { return <OfficePage />; }
