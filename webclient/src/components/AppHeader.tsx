import { useRef, useState } from "react"
import { Link, useNavigate, useLocation } from "react-router-dom"
import {
  Search,
  Bell,
  UserCircle,
  LogOut,
  X,
  Eye,
  Sparkles,
} from "lucide-react"
import { useAuth } from "@/context/auth-provider"
import { useWatchlistContext } from "@/context/watchlist-provider"
import { useLlmInsights } from "@/context/llm-insights-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function AppHeader() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, logout, requireAuth } = useAuth()
  const { enabled: insightsEnabled, toggle: toggleInsights } = useLlmInsights()
  const { alerts } = useWatchlistContext()

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const openSearch = () => {
    setSearchOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery("")
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = searchQuery.trim()
    if (!q) return
    navigate(`/search?q=${encodeURIComponent(q)}`)
    closeSearch()
  }

  const handleWatchlistClick = (e: React.MouseEvent) => {
    e.preventDefault()
    requireAuth(() => navigate("/watchlist"))()
  }

  const handleNotificationsClick = () => {
    if (!isAuthenticated) {
      navigate("/login", { state: { backgroundLocation: location } })
    }
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center gap-2 px-4">
        {/* Left: brand + search */}
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
          >
            <img
              src="/icon.png"
              alt="Sentinel Finance"
              className="size-6 rounded-md"
            />
            <span className="text-sm font-semibold tracking-tight text-primary">
              Sentinel Finance
            </span>
          </Link>

          {searchOpen ? (
            <form
              onSubmit={handleSearchSubmit}
              className="flex items-center gap-1"
            >
              <Input
                ref={inputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ticker, e.g. AAPL"
                className="h-8 w-48 text-sm"
                onKeyDown={(e) => e.key === "Escape" && closeSearch()}
              />
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                className="h-8 px-2"
              >
                <Search className="size-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                onClick={closeSearch}
              >
                <X className="size-4" />
              </Button>
            </form>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={openSearch}
              aria-label="Open search"
            >
              <Search className="size-4" />
            </Button>
          )}
        </div>

        {/* Right: watchlist, notifications, profile */}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            role="switch"
            aria-checked={insightsEnabled}
            className="gap-2"
            onClick={toggleInsights}
          >
            <Sparkles className="size-4" />
            <span className="hidden lg:inline">LLM Insights</span>
            <span
              className={cn(
                "relative h-5 w-9 rounded-full transition-colors",
                insightsEnabled ? "bg-primary" : "bg-muted"
              )}
              aria-hidden="true"
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 size-4 rounded-full bg-background shadow-sm transition-transform",
                  insightsEnabled && "translate-x-4"
                )}
              />
            </span>
          </Button>

          {/* Watchlist */}
          <Button variant="ghost" size="sm" asChild className="gap-1.5">
            <a href="/watchlist" onClick={handleWatchlistClick}>
              <Eye className="size-4" />
              <span className="hidden md:inline">Watchlist</span>
            </a>
          </Button>

          {/* Notifications */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Notifications"
                className="relative"
                onClick={handleNotificationsClick}
              >
                <Bell className="size-4" />
                {isAuthenticated && alerts.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                    {alerts.length > 9 ? "9+" : alerts.length}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            {isAuthenticated && (
              <PopoverContent
                align="end"
                className="max-h-96 w-80 overflow-y-auto"
              >
                <h4 className="mb-2 font-semibold">Recent Alerts</h4>
                {alerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No recent alerts
                  </p>
                ) : null}
                <div className="flex flex-col gap-2">
                  {alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="border-b pb-2 text-sm last:border-b-0"
                    >
                      <span className="block font-bold">{alert.ticker}</span>
                      <span className="text-muted-foreground">
                        Score: {alert.avgScore.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            )}
          </Popover>

          {/* Profile */}
          {isAuthenticated ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Account">
                  <UserCircle className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer gap-2"
                >
                  <LogOut className="size-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Log in"
              onClick={() =>
                navigate("/login", { state: { backgroundLocation: location } })
              }
            >
              <UserCircle className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
