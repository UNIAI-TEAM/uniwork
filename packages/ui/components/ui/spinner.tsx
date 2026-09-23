import { cn } from "@uniwork/ui/lib/utils"
import { Loader2Icon } from "lucide-react"

/**
 * Decorative by default: the text beside it says what is loading, and a
 * primitive cannot know the page's language. Pass `label` (or `aria-label`)
 * when the spinner is the only sign of progress, and it becomes a status.
 */
function Spinner({
  className,
  label,
  ...props
}: React.ComponentProps<"svg"> & { label?: string }) {
  const name = label ?? props["aria-label"]
  const a11y = name
    ? { role: "status", "aria-label": name }
    : { "aria-hidden": true as const }
  return (
    <Loader2Icon className={cn("size-4 animate-spin", className)} {...a11y} {...props} />
  )
}

export { Spinner }
