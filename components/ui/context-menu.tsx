"use client"

import * as React from "react"
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Right-click menu — same surface contract as `dropdown-menu.tsx`
 * (docs/design/overlays.md), just triggered by `contextmenu` instead of a
 * click: min 200 / max 320 wide, radius 10, 6px padding, 34px items at
 * radius 7, a 24px glyph column, submenus flip on collision. Kept as a
 * parallel file rather than a shared base — Radix ships the two primitives
 * as genuinely separate trees, not a shared one behind two triggers.
 */

const ContextMenu = ContextMenuPrimitive.Root

const ContextMenuTrigger = ContextMenuPrimitive.Trigger

const ContextMenuGroup = ContextMenuPrimitive.Group

const ContextMenuPortal = ContextMenuPrimitive.Portal

const ContextMenuSub = ContextMenuPrimitive.Sub

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

const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean
    icon?: React.ReactNode
  }
>(({ className, inset, icon, children, ...props }, ref) => {
  const glyph = useGlyphColumn(icon)
  return (
    <ContextMenuPrimitive.SubTrigger
      ref={ref}
      className={cn(ITEM_CLASS, "data-[state=open]:bg-surface-menu-hover data-[state=open]:text-ink", inset && "pl-8", className)}
      {...props}
    >
      {glyph}
      {children}
      <ChevronRight className="ml-auto h-4 w-4" strokeWidth={1.5} />
    </ContextMenuPrimitive.SubTrigger>
  )
})
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName

const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubContent ref={ref} className={cn(CONTENT_CLASS, className)} {...props}>
    <GlyphColumnProvider>{children}</GlyphColumnProvider>
  </ContextMenuPrimitive.SubContent>
))
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, children, collisionPadding = 8, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      collisionPadding={collisionPadding}
      className={cn(CONTENT_CLASS, className)}
      {...props}
    >
      <GlyphColumnProvider>{children}</GlyphColumnProvider>
    </ContextMenuPrimitive.Content>
  </ContextMenuPrimitive.Portal>
))
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName

/* ---------------------------------------------------------------------- items */

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean
    icon?: React.ReactNode
    variant?: "default" | "destructive"
  }
>(({ className, inset, icon, variant = "default", children, ...props }, ref) => {
  const glyph = useGlyphColumn(icon)

  return (
    <ContextMenuPrimitive.Item
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
    </ContextMenuPrimitive.Item>
  )
})
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName

const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem> & {
    icon?: React.ReactNode
  }
>(({ className, icon, children, checked, ...props }, ref) => {
  const glyph = useGlyphColumn(icon)
  return (
    <ContextMenuPrimitive.CheckboxItem ref={ref} className={cn(ITEM_CLASS, className)} checked={checked} {...props}>
      {glyph}
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  )
})
ContextMenuCheckboxItem.displayName = ContextMenuPrimitive.CheckboxItem.displayName

const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2.5 pb-1.5 pt-2 text-[10px] font-semibold uppercase leading-none tracking-[0.13em] font-sans text-ink-4",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator ref={ref} className={cn("-mx-1.5 my-1.5 h-px bg-line-soft", className)} {...props} />
))
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName

const ContextMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={cn("ml-auto flex-shrink-0 text-xs tracking-widest text-ink-5", className)} {...props} />
}
ContextMenuShortcut.displayName = "ContextMenuShortcut"

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
}
