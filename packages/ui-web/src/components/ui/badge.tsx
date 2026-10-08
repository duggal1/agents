import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@sapphire/ui-web/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden border border-transparent font-normal whitespace-nowrap outline-none transition-colors duration-150 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      /* DESIGN.MD sizes. `sm` is the dense-row default the product already
         ships (session chips, connection status); `md` is the roomier form for
         standalone status lines. */
      size: {
        sm: "rounded-sm px-2 py-0.5 text-[12px] leading-4",
        md: "rounded-[3px] px-2.5 py-1 text-[14px] leading-5 tracking-[-0.09px]",
      },
      /* DESIGN.MD: a 12% tint with the -300 shade, never a solid fill, never a border.
         Color only ever carries meaning. */
      variant: {
        default: "bg-neutral-50/8 text-neutral-300",
        neutral: "bg-neutral-50/8 text-neutral-300",
        secondary: "bg-neutral-800 text-neutral-200",
        sky: "bg-sky-400/12 text-sky-300",
        blue: "bg-blue-400/12 text-blue-300",
        violet: "bg-violet-400/12 text-violet-300",
        purple: "bg-purple-400/12 text-purple-300",
        fuchsia: "bg-fuchsia-400/12 text-fuchsia-300",
        yellow: "bg-yellow-400/12 text-yellow-300",
        rose: "bg-rose-400/12 text-rose-300",
        green: "bg-green-400/12 text-green-300",
        orange: "bg-orange-400/12 text-orange-300",
        destructive: "bg-orange-400/12 text-orange-300",
        outline: "border border-neutral-700/50 text-neutral-300",
        ghost: "text-neutral-300 hover:bg-neutral-800",
        link: "text-foreground underline decoration-dotted underline-offset-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  },
);

function Badge({
  className,
  variant = "default",
  size = "sm",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, size }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
      size,
    },
  });
}

export { Badge, badgeVariants };
