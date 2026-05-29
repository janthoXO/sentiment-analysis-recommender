import type {
  SourceResultRoot,
  SourceRoot,
  StockRoot,
} from "../generated/in/index.js";
import type { AnalyzerService } from "./analyzer.service.js";
import { sanitizeError, errorCode } from "../middleware/httpError.js";

export interface StreamError {
  error: string;
  code: string;
  ticker?: string;
}

export interface SentimentService {
  streamSentimentForArticles(
    stock: StockRoot,
    sources: SourceRoot[]
  ): AsyncGenerator<SourceResultRoot | StreamError>;
}

export function makeSentimentService({
  analyzer,
}: {
  analyzer: AnalyzerService;
}): SentimentService {
  return {
    async *streamSentimentForArticles(stock, sources) {
      try {
        yield* analyzer.requestSentiment(stock, sources);
      } catch (e) {
        console.error(`Sentiment stream failed for ${stock.ticker}:`, e);
        yield {
          error: sanitizeError(e, "Sentiment analysis failed"),
          code: errorCode(e),
          ticker: stock.ticker,
        } satisfies StreamError;
      }
    },
  };
}
