"use client";

import { Plug } from "lucide-react";
import { cn } from "@uniwork/ui/lib/utils";
import { ClaudeMark, GeminiMark, OpenAIMark } from "../../common/provider-icons";

type Kind = "claude" | "openai" | "gemini" | "generic";

/**
 * Which assistant a grant belongs to. `client_name` is whatever the client
 * declared when it registered, so a name alone never earns a brand's mark: an
 * unverified client calling itself "ChatGPT" would borrow OpenAI's trust. Only
 * a verified client (every redirect host on the known list) gets one.
 */
function kindOf(client: string, verified: boolean): Kind {
  if (!verified) return "generic";
  const name = client.toLowerCase();
  if (/chatgpt|openai/.test(name)) return "openai";
  if (/claude/.test(name)) return "claude";
  if (/gemini/.test(name)) return "gemini";
  return "generic";
}

/** The leading mark of a connected-app row. Decorative: the row's title names the client. */
export function AssistantMark({ client, verified }: { client: string; verified: boolean }) {
  const kind = kindOf(client, verified);
  const props = { className: "size-5", "data-assistant-mark": kind } as const;
  if (kind === "openai") return <OpenAIMark {...props} />;
  if (kind === "claude") return <ClaudeMark {...props} />;
  if (kind === "gemini") return <GeminiMark {...props} />;
  return <Plug aria-hidden {...props} className={cn(props.className, "text-muted-foreground")} />;
}

/** The assistants the connect sections name, as marks beside the heading. */
export function AssistantMarks() {
  return (
    <span aria-hidden className="inline-flex items-center gap-1.5">
      <ClaudeMark className="size-4" />
      <OpenAIMark className="size-4" />
      <GeminiMark className="size-4" />
    </span>
  );
}
