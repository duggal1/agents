import { cn } from "@sapphire/ui-web/lib/utils";
import type * as React from "react";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-neutral-700/50 bg-neutral-850/80 px-2.5 py-2 text-[14px] text-neutral-100 shadow-none transition-colors outline-none placeholder:text-neutral-500 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
