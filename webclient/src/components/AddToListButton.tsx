import { useState } from "react"
import { Bookmark, Plus } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { useAuth } from "@/context/auth-provider"
import { useWatchlistContext } from "@/context/watchlist-provider"
import { cn } from "@/lib/utils"

interface AddToListButtonProps {
  ticker: string
  className?: string
}

export function AddToListButton({ ticker, className }: AddToListButtonProps) {
  const { requireAuth } = useAuth()
  const {
    lists,
    listsContainingTicker,
    addToList,
    removeFromList,
    createList,
  } = useWatchlistContext()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const inLists = listsContainingTicker(ticker)
  const isInAnyList = inLists.length > 0

  const handleTrigger = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    requireAuth(() => setOpen(true))()
  }

  const filteredLists = lists.filter((l) =>
    l.name.toLowerCase().includes(query.toLowerCase())
  )
  const showCreate =
    query.trim().length > 0 &&
    !lists.some((l) => l.name.toLowerCase() === query.trim().toLowerCase())

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "cursor-pointer rounded p-0.5 transition-colors",
            isInAnyList
              ? "text-primary"
              : "text-muted-foreground hover:text-primary",
            className
          )}
          onClick={handleTrigger}
          aria-label="Add to list"
        >
          <Bookmark size={20} className={isInAnyList ? "fill-primary" : ""} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-0"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput
            placeholder="Search or create list..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {filteredLists.length === 0 && !showCreate && (
              <CommandEmpty>No lists found.</CommandEmpty>
            )}
            {filteredLists.length > 0 && (
              <CommandGroup>
                {filteredLists.map((list) => {
                  const isIn = inLists.some((l) => l.id === list.id)
                  return (
                    <CommandItem
                      key={list.id}
                      value={list.name}
                      data-checked={isIn}
                      onSelect={() => {
                        if (isIn) void removeFromList(list.id, ticker)
                        else void addToList(list.id, ticker)
                      }}
                    >
                      {list.name}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
            {showCreate && (
              <>
                {filteredLists.length > 0 && <CommandSeparator />}
                <CommandGroup>
                  <CommandItem
                    value={`__create__${query.trim()}`}
                    onSelect={() => {
                      const name = query.trim()
                      void createList(name).then((list) => {
                        if (list) void addToList(list.id, ticker)
                      })
                      setQuery("")
                      setOpen(false)
                    }}
                  >
                    <Plus className="mr-2 size-4" />
                    Create &quot;{query.trim()}&quot;
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
