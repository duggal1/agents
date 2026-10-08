import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@rakazo/ui-web/lib/utils";
import type * as React from "react";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8.5 w-full min-w-0 rounded-lg border border-neutral-700/50 bg-neutral-850/80 px-2.5 py-1 text-[14px] text-neutral-100 shadow-none transition-colors outline-none file:inline-flex file:h-6 file:cursor-pointer file:border-0 file:bg-transparent file:text-[13px] file:font-normal file:text-foreground placeholder:text-neutral-500 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-default disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
