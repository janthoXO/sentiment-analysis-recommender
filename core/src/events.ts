import { EventEmitter } from "events";
import type { TickerResultRoot } from "./generated/in/index.js";

export const sentimentEmitter = new EventEmitter();

export interface SentimentChangeEvent {
  ticker: string;
  result: TickerResultRoot;
}
