"use client"

import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Dropdown / popover — the fifth overlay pattern (docs/design/overlays.md).
 *
 * min 200 / max 320 wide, radius 10, 6px padding, items 34px tall with radius 7
 * and a 24px glyph column so labels align whether or not an item has an icon.
 * Anchored to the trigger with a 4px offset, flipping on collision. No scrim:
 * a dropdown inside a modal is the one legal overlay-on-overlay.
 */

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const DropdownMenuPortal = DropdownMenuPrimitive.Portal

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const CONTENT_CLASS =
  "z-50 min-w-[200px] max-w-[320px] animate-menu-in overflow-hidden rounded-[10px] border-[0.5px] border-border bg-popover p-1.5 font-sans text-popover-foreground shadow-float-md"

const ITEM_CLASS =
  "relative flex h-[34px] cursor-default select-none items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] font-sans text-ink-2 outline-none transition-colors focus:bg-surface-menu-hover focus:text-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-50"

/* --------------------------------------------------------------- glyph column */

interface GlyphColumnContextValue {
  register: () => () => void
  enabled: boolean
}

const GlyphColumnContext = React.createContext<GlyphColumnContextValue | null>(null)

/**
 * A menu turns its glyph column on as soon as one of its items declares an
 * `icon`, so text-only siblings indent with it instead of hugging the edge.
 */
function GlyphColumnProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = React.useState(0)

  const register = React.useCallback(() => {
    setCount((current) => current + 1)
    return () => setCount((current) => current - 1)
  }, [])

  const value = React.useMemo<GlyphColumnContextValue>(() => ({ register, enabled: count > 0 }), [count, register])

  return <GlyphColumnContext.Provider value={value}>{children}</GlyphColumnContext.Provider>
}

function useGlyphColumn(icon: React.ReactNode) {
  const context = React.useContext(GlyphColumnContext)
  const hasIcon = icon !== undefined && icon !== null

  React.useEffect(() => {
    if (!hasIcon || !context) return
    return context.register()
  }, [context, hasIcon])

  const visible = hasIcon || Boolean(context?.enabled)

  return visible ? (
    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center [&_svg]:h-[15px] [&_svg]:w-[15px]">
      {icon}
    </span>
  ) : null
}

/* ------------------------------------------------------------------- surfaces */

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(ITEM_CLASS, "data-[state=open]:bg-surface-menu-hover data-[state=open]:text-ink", inset && "pl-8", className)}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" strokeWidth={1.5} />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent ref={ref} className={cn(CONTENT_CLASS, className)} {...props}>
    <GlyphColumnProvider>{children}</GlyphColumnProvider>
  </DropdownMenuPrimitive.SubContent>
))
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, children, sideOffset = 4, collisionPadding = 8, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(CONTENT_CLASS, className)}
      {...props}
    >
      <GlyphColumnProvider>{children}</GlyphColumnProvider>
    </DropdownMenuPrimitive.Content>
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

/* ---------------------------------------------------------------------- items */

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
    /** Leading glyph. Its presence turns the 24px column on for the whole menu. */
    icon?: React.ReactNode
    /** Destructive actions are terracotta text on hover, never a red fill. */
    variant?: "default" | "destructive"
  }
>(({ className, inset, icon, variant = "default", children, ...props }, ref) => {
  const glyph = useGlyphColumn(icon)

  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      data-variant={variant}
      className={cn(
        ITEM_CLASS,
        variant === "destructive" && "hover:text-cursor focus:text-cursor",
        inset && "pl-8",
        className
      )}
      {...props}
    >
      {glyph}
      {children}
    </DropdownMenuPrimitive.Item>
  )
})
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem ref={ref} className={cn(ITEM_CLASS, className)} checked={checked} {...props}>
    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" strokeWidth={1.5} />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem ref={ref} className={cn(ITEM_CLASS, className)} {...props}>
    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" strokeWidth={1.5} />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2.5 pb-1.5 pt-2 text-[10px] font-semibold uppercase leading-none tracking-[0.13em] font-sans text-ink-4",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn("-mx-1.5 my-1.5 h-px bg-line-soft", className)} {...props} />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={cn("ml-auto flex-shrink-0 text-xs tracking-widest text-ink-5", className)} {...props} />
}
DropdownMenuShortcut.displayName = "DropdownMenuShortcut"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup
}
