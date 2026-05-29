import { Link } from "react-router-dom"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { parseSentimentLabel } from "@/lib/sentiment"
import {
  useCompetitorSentiment,
  type CompetitorState,
} from "@/hooks/useCompetitorSentiment"
import type { Stock } from "@/models/Stock"

interface Props {
  ticker: string
}

const VISIBLE_COUNT = 3

interface PeerRowProps {
  stock: Stock
  state: CompetitorState | undefined
}

function PeerRow({ stock, state }: PeerRowProps) {
  const sentiment =
    state?.stock.avgScore != null
      ? parseSentimentLabel(state.stock.avgScore)
      : null

  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Link
          to={`/stock/${stock.ticker}`}
          className="truncate text-sm leading-snug font-semibold hover:underline"
        >
          {stock.name}
        </Link>
        <span className="text-xs text-muted-foreground">{stock.ticker}</span>
      </div>
      {state?.loading ? (
        <Skeleton className="h-5 w-16 rounded-full" />
      ) : sentiment ? (
        <Badge
          variant="outline"
          className={cn("shrink-0 text-xs font-bold", sentiment.className)}
        >
          {sentiment.label} · {state!.stock!.avgScore!.toFixed(2)}
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="shrink-0 text-xs font-bold text-muted-foreground"
        >
          —
        </Badge>
      )}
    </div>
  )
}

export function CompetitorsAccordion({ ticker }: Props) {
  const { peers, stateByTicker, peersLoading, loadSentiment } =
    useCompetitorSentiment(ticker)

  if (peersLoading && peers.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    )
  }

  if (peers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No competitors found.</p>
    )
  }

  const visiblePeers = peers.slice(0, VISIBLE_COUNT)
  const morePeers = peers.slice(VISIBLE_COUNT)

  return (
    <div className="flex flex-col">
      <div className="divide-y">
        {visiblePeers.map((stock) => (
          <PeerRow
            key={stock.ticker}
            stock={stock}
            state={stateByTicker[stock.ticker]}
          />
        ))}
      </div>

      {morePeers.length > 0 && (
        <Accordion
          type="single"
          collapsible
          onValueChange={(v) => {
            if (v === "more") {
              for (const s of morePeers) loadSentiment(s.ticker)
            }
          }}
        >
          <AccordionItem value="more" className="border-0">
            <AccordionTrigger className="py-2 text-xs text-muted-foreground hover:no-underline">
              Show more competitors ({morePeers.length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="divide-y">
                {morePeers.map((stock) => (
                  <PeerRow
                    key={stock.ticker}
                    stock={stock}
                    state={stateByTicker[stock.ticker]}
                  />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  )
}
