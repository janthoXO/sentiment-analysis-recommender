import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"

export function ResultCardSkeleton() {
  return (
    <div className="block w-full max-w-sm">
      <Card className="group h-full transition-colors">
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <div>
            <Skeleton className="mb-1 h-6 w-16" />
            <Skeleton className="mt-0.5 h-3 w-24" />
          </div>
          <div className="flex items-center gap-2">
            {/* AddToListButton skeleton */}
            <Skeleton className="h-9 w-9 rounded-md" />
            {/* Sentiment Badge skeleton */}
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </CardHeader>

        <CardContent className="pb-2">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="mb-1 block text-muted-foreground">
                <Skeleton className="h-4 w-16" />
              </span>
              <span className="text-lg font-medium">
                <Skeleton className="mt-1 h-6 w-12" />
              </span>
            </div>
            <div>
              <span className="mb-1 block text-muted-foreground">
                <Skeleton className="h-4 w-16" />
              </span>
              <span className="text-lg font-medium">
                <Skeleton className="mt-1 h-6 w-10" />
              </span>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col items-start gap-2 pt-0">
          <Separator className="mb-2" />
          <span className="w-full text-xs font-semibold text-muted-foreground">
            <Skeleton className="h-3 w-20" />
          </span>

          <div className="mt-1 flex w-full flex-col gap-1.5">
            <div className="flex items-start justify-between gap-2">
              <Skeleton className="h-4 flex-1 rounded" />
              <Skeleton className="h-4 w-10 shrink-0 rounded-full" />
            </div>
            <Skeleton className="h-3 w-4/5 rounded" />
            <Skeleton className="h-3 w-3/4 rounded" />
          </div>

          <div className="mt-2 flex w-full flex-col gap-1.5">
            <div className="flex items-start justify-between gap-2">
              <Skeleton className="h-4 flex-1 rounded" />
              <Skeleton className="h-4 w-10 shrink-0 rounded-full" />
            </div>
            <Skeleton className="h-3 w-11/12 rounded" />
            <Skeleton className="h-3 w-2/3 rounded" />
          </div>

          <div className="mt-2 flex w-full flex-col gap-1.5">
            <div className="flex items-start justify-between gap-2">
              <Skeleton className="h-4 flex-1 rounded" />
              <Skeleton className="h-4 w-10 shrink-0 rounded-full" />
            </div>
            <Skeleton className="h-3 w-full rounded" />
            <Skeleton className="h-3 w-3/4 rounded" />
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
