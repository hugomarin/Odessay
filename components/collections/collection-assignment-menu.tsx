"use client"

import { useState, type ReactNode } from "react"
import { FolderPlus } from "lucide-react"
import { CollectionCreateDialog } from "@/components/collections/collection-create-dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { CollectionOption } from "@/lib/collections/collections"

type CollectionAssignmentMenuProps = {
  collections: CollectionOption[]
  selectedIds: string[]
  align?: "start" | "center" | "end"
  trigger: ReactNode
  onToggleCollection: (collectionId: string) => Promise<void> | void
  onCreateCollection: (name: string) => Promise<void> | void
}

export function CollectionAssignmentMenu({
  collections,
  selectedIds,
  align = "end",
  trigger,
  onToggleCollection,
  onCreateCollection,
}: CollectionAssignmentMenuProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-[220px]">
          <DropdownMenuLabel>Collections</DropdownMenuLabel>
          {collections.length === 0 ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                setCreateOpen(true)
              }}
            >
              Create your first collection
            </DropdownMenuItem>
          ) : (
            <>
              {collections.map((collection) => (
                <DropdownMenuCheckboxItem
                  key={collection.id}
                  checked={selectedIds.includes(collection.id)}
                  onSelect={(event) => {
                    event.preventDefault()
                    void onToggleCollection(collection.id)
                  }}
                >
                  {collection.name}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
                <FolderPlus className="mr-2 h-4 w-4" strokeWidth={1.5} />
                New collection...
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <CollectionCreateDialog
        open={createOpen}
        pending={isCreating}
        onOpenChange={setCreateOpen}
        onSubmit={async (name) => {
          setIsCreating(true)
          try {
            await onCreateCollection(name)
            setCreateOpen(false)
          } finally {
            setIsCreating(false)
          }
        }}
      />
    </>
  )
}
