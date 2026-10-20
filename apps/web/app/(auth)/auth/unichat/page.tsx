"use client";
import { useEffect } from "react";
import { paths } from "@uniwork/core/paths";
import { useNavigation } from "@uniwork/views/navigation";

/**
 * Where the UniChat shell opens. /login's server HTML is the web sign-in form,
 * painted before the page knows it runs in the shell; this page renders
 * nothing on the server and moves to /login on the client, where the shell
 * branch decides straight away: the gate when signed out, the chat when signed in.
 */
export default function UniChatStartPage() {
  const { replace } = useNavigation();
  useEffect(() => {
    replace(paths.login());
  }, [replace]);
  return null;
}
