import { cn } from "@rakazo/ui-web/lib/utils";
import type * as React from "react";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex cursor-pointer items-center gap-2 text-[13px] leading-none text-neutral-300 select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-60 peer-disabled:cursor-default peer-disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
