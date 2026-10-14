import { RequestDemoPage } from "../../features/landing/request-demo-page";
import { marketingMetadata } from "../../platform/feature-metadata";
import { paths } from "@uniwork/core/paths";
export function generateMetadata() { return marketingMetadata("demo", paths.requestDemo()); }
export default function Page() { return <RequestDemoPage />; }
