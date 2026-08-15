"use client"

import { useState } from "react"
import { ArrowLeft, ArrowRight, Copy, Pencil, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DisplayModal } from "@/components/ui/display-modal"
import { FormModal } from "@/components/ui/dialog"
import { FlowModal, FlowModalBody, FlowModalFooter, FlowModalHeader, FlowModalStep } from "@/components/ui/flow-modal"
import { FullOverlay } from "@/components/ui/full-overlay"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"

/**
 * Demonstration page for the closed overlay inventory — one trigger per pattern.
 * It is the visual evidence surface of ODE-427 and the keyboard walkthrough
 * target; it ships nothing to production.
 */

const FLOW_STEPS = ["pick", "configure", "done"] as const

function FlowModalDemo() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [name, setName] = useState("")

  const stepKey = FLOW_STEPS[step]

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="open-flow-modal">
        Flow modal
      </Button>
      <FlowModal
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setStep(0)
            setName("")
          }
        }}
        title="Add workspace"
        dirty={name.trim().length > 0 && stepKey !== "done"}
        onBack={step > 0 ? () => setStep((current) => current - 1) : undefined}
      >
        <FlowModalStep stepKey={stepKey}>
          <FlowModalHeader>
            <p className="text-[10px] font-semibold uppercase leading-none tracking-[0.13em] text-ink-4">
              Step {step + 1} of {FLOW_STEPS.length}
            </p>
            <h2 className="mt-2 text-[22px] font-medium tracking-[-0.01em] text-ink">
              {stepKey === "pick" ? "Choose a folder" : stepKey === "configure" ? "Name it" : "All set"}
            </h2>
          </FlowModalHeader>

          <FlowModalBody>
            {stepKey === "configure" ? (
              <input
                aria-label="Workspace name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Workspace name"
                className="h-11 w-full rounded-[9px] border-[0.5px] border-border bg-sb px-3 text-sm text-ink outline-none"
              />
            ) : (
              <div className="space-y-2">
                {Array.from({ length: stepKey === "pick" ? 8 : 3 }, (_, index) => (
                  <p key={index} className="text-sm text-ink-3">
                    Scrolling middle keeps a 150px floor — the header yields first.
                  </p>
                ))}
              </div>
            )}
          </FlowModalBody>

          <FlowModalFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                step === FLOW_STEPS.length - 1 ? setOpen(false) : setStep((current) => current + 1)
              }
            >
              {step === FLOW_STEPS.length - 1 ? "Done" : "Continue"}
            </Button>
          </FlowModalFooter>
        </FlowModalStep>
      </FlowModal>
    </>
  )
}

function FormModalDemo() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="open-form-modal">
        Form modal
      </Button>
      <FormModal
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setValue("")
        }}
        title="Rename artifact"
        overline="Artifact name"
        dirty={value.trim().length > 0}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Save</Button>
          </>
        }
      >
        <input
          aria-label="Artifact name"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Untitled"
          className="h-11 w-full rounded-[9px] border-[0.5px] border-border bg-sb px-3 text-sm text-ink outline-none"
        />
      </FormModal>
    </>
  )
}

function DisplayModalDemo() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="open-display-modal">
        Display modal
      </Button>
      <DisplayModal open={open} onOpenChange={setOpen} title="Keyboard shortcuts">
        <div className="grid grid-cols-3 gap-x-8 gap-y-2.5">
          {[
            ["⌘K", "Search"],
            ["⌘S", "Save"],
            ["⌘/", "Shortcuts"],
            ["⌘B", "Bold"],
            ["⌘I", "Italic"],
            ["Esc", "Close overlay"]
          ].map(([keys, label]) => (
            <div key={keys} className="flex items-center justify-between gap-4 border-b-[0.5px] border-line-soft py-2">
              <span className="text-[13px] text-ink-2">{label}</span>
              <kbd className="text-xs tracking-widest text-ink-5">{keys}</kbd>
            </div>
          ))}
        </div>
      </DisplayModal>
    </>
  )
}

function FullOverlayDemo() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="open-full-overlay">
        Full overlay
      </Button>
      <FullOverlay
        open={open}
        onOpenChange={setOpen}
        title="Artifact preview"
        chromeStart={
          <>
            <Button variant="ghost" size="icon" aria-label="Previous">
              <ArrowLeft strokeWidth={1.5} />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Next">
              <ArrowRight strokeWidth={1.5} />
            </Button>
          </>
        }
      >
        <div className="mx-auto max-w-[720px] px-6 py-12">
          <h2 className="font-lora text-[32px] font-medium text-ink">A preview surface</h2>
          <p className="mt-4 text-base leading-relaxed text-ink-2">
            The full overlay owns the viewport and carries its own 48px chrome row. Views bring the content.
          </p>
        </div>
      </FullOverlay>
    </>
  )
}

function DropdownDemo() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-testid="open-dropdown">Dropdown</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem icon={<Pencil strokeWidth={1.5} />}>Rename</DropdownMenuItem>
        <DropdownMenuItem icon={<Copy strokeWidth={1.5} />}>Duplicate</DropdownMenuItem>
        <DropdownMenuItem>Move to…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" icon={<Trash2 strokeWidth={1.5} />}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function OverlayHarnessClient() {
  return (
    <main data-overlay-focus-anchor className="min-h-screen bg-bg px-6 py-10">
      <div className="mx-auto max-w-[720px]">
        <h1 className="font-lora text-[28px] font-medium text-ink">Overlay harness</h1>
        <p className="mt-2 text-[13px] text-ink-4">
          The five patterns of the closed inventory — docs/design/overlays.md. Nothing outside this list exists.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <FlowModalDemo />
          <FormModalDemo />
          <DisplayModalDemo />
          <FullOverlayDemo />
          <DropdownDemo />
        </div>
      </div>
    </main>
  )
}
