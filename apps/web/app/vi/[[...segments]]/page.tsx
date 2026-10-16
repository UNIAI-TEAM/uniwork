import { notFound } from "next/navigation";
import { MARKETING_ROUTES, marketingRoute } from "@uniwork/core/paths";
import { publicPage } from "../../../platform/public-page";
import { seoMetadata } from "../../../platform/seo";

type Props = { params: Promise<{ segments?: string[] }> };
export const dynamicParams = false;
export function generateStaticParams() { return MARKETING_ROUTES.map(route => ({ segments: route.path === "/" ? [] : route.path.slice(1).split("/") })); }
async function publicPath({ params }: Props) {
  const { segments = [] } = await params;
  const path = `/${segments.join("/")}`;
  if (!marketingRoute(path)) notFound();
  return path;
}
export async function generateMetadata(props: Props) { return seoMetadata(await publicPath(props), "vi"); }
export default async function Page(props: Props) { return publicPage(await publicPath(props), "vi"); }
