"use client";

import { useParams } from "next/navigation";
import { PersonDetailView } from "@uniwork/views/people";

export default function Page() {
  const { userId } = useParams<{ userId: string }>();
  return <PersonDetailView userId={userId} />;
}
