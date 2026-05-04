import z from "zod";
import { env } from "../env.js";
const PolygonResponse = z.object({
    results: z
        .array(z.object({
        ticker: z.string(),
        share_class_figi: z.string().optional(),
        name: z.string(),
    }))
        .optional(),
});
export async function fetchFigiForTicker(ticker) {
    const url = `https://api.polygon.io/v3/reference/tickers?ticker=${ticker}&active=true&limit=1&apiKey=${env.POLYGON_API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error("Failed to fetch from Polygon API");
    }
    const data = PolygonResponse.parse(await response.json());
    const result = data.results?.[0];
    if (!result) {
        throw new Error(`Ticker ${ticker} not found in Polygon`);
    }
    return {
        ticker: result.ticker,
        figi: result.share_class_figi || `BBG000${ticker}`,
        name: result.name,
    };
}
//# sourceMappingURL=polygon.api.js.map