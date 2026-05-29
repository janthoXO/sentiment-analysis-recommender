import { useEffect, useState, useCallback } from "react"
import {
  ChevronsUpDown,
  MoreHorizontal,
  Pencil,
  Trash2,
  Plus,
  RefreshCw,
} from "lucide-react"
import { useAuth } from "@/context/auth-provider"
import { useWatchlistContext } from "@/context/watchlist-provider"
import { ResultCard } from "@/components/ResultCard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useSearchPipeline } from "@/hooks/useSearchPipeline"
import type { List } from "@/api/generated/dtos"

export default function WatchlistPage() {
  const { requireAuth } = useAuth()
  const { lists, createList, renameList, deleteList } = useWatchlistContext()
  const { resultsByTicker, order, loading, search } = useSearchPipeline()

  const [comboOpen, setComboOpen] = useState(false)
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [createValue, setCreateValue] = useState("")

  useEffect(() => {
    requireAuth(() => {})()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeList: List | undefined =
    lists.find((l) => l.id === selectedListId) ?? lists[0]
  const activeListId = activeList?.id ?? null

  const loadSentiment = useCallback(() => {
    if (!activeList || activeList.items.length === 0) return
    void search({ tickerIds: activeList.items.map((i) => i.ticker) })
  }, [activeList, search])

  useEffect(() => {
    loadSentiment()
  }, [loadSentiment])

  const handleRenameOpen = () => {
    setRenameValue(activeList?.name ?? "")
    setRenameOpen(true)
  }

  const handleRenameSubmit = async () => {
    if (!activeListId || !renameValue.trim()) return
    await renameList(activeListId, renameValue.trim())
    setRenameOpen(false)
  }

  const handleDeleteConfirm = async () => {
    if (!activeListId) return
    await deleteList(activeListId)
    setDeleteOpen(false)
  }

  const handleCreateSubmit = async () => {
    if (!createValue.trim()) return
    const list = await createList(createValue.trim())
    if (list) setSelectedListId(list.id)
    setCreateValue("")
    setCreateOpen(false)
  }

  const renderGrid = () => {
    if (!activeList) return null
    if (activeList.items.length === 0) {
      return (
        <div className="pt-4 text-muted-foreground">
          This list is empty. Search for tickers and add them with the bookmark
          icon.
        </div>
      )
    }
    if (loading && order.length === 0) {
      return (
        <div className="grid grid-cols-1 gap-6 pt-4 md:grid-cols-2 lg:grid-cols-3">
          {activeList.items.map((item) => (
            <Skeleton key={item.ticker} className="h-64 w-full rounded-xl" />
          ))}
        </div>
      )
    }
    return (
      <div className="grid grid-cols-1 gap-6 pt-4 md:grid-cols-2 lg:grid-cols-3">
        {activeList.items.map((item) => {
          const state = resultsByTicker.get(item.ticker)
          return (
            <ResultCard
              key={item.ticker}
              stock={state?.stock ?? { ticker: item.ticker, name: item.ticker }}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col">
      <div className="mb-8 w-full max-w-4xl space-y-4">
        <h1 className="text-4xl font-bold tracking-tight text-primary">
          Your Equities
        </h1>
        <p className="text-lg text-muted-foreground">
          Manage your watchlists and portfolio.
        </p>
      </div>

      <div className="mb-6 flex items-center gap-2">
        <Popover open={comboOpen} onOpenChange={setComboOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-52 justify-between">
              {activeList?.name ?? "Select list"}
              <ChevronsUpDown className="ml-2 size-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search lists..." />
              <CommandList>
                <CommandEmpty>No lists found.</CommandEmpty>
                <CommandGroup>
                  {lists.map((list) => (
                    <CommandItem
                      key={list.id}
                      value={list.name}
                      data-checked={list.id === activeListId}
                      onSelect={() => {
                        setSelectedListId(list.id)
                        setComboOpen(false)
                      }}
                    >
                      {list.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="__create_new__"
                    onSelect={() => {
                      setComboOpen(false)
                      setCreateOpen(true)
                    }}
                  >
                    <Plus className="mr-2 size-4" />
                    Create new list
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {activeList && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={handleRenameOpen}>
                <Pencil className="mr-2 size-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-2 size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {activeList && activeList.items.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={loadSentiment}
            disabled={loading}
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        )}
      </div>

      {renderGrid()}

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename list</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleRenameSubmit()}
            placeholder="List name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleRenameSubmit()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create new list</DialogTitle>
          </DialogHeader>
          <Input
            value={createValue}
            onChange={(e) => setCreateValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleCreateSubmit()}
            placeholder="List name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreateSubmit()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &quot;{activeList?.name}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the list and all its tickers. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDeleteConfirm()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
