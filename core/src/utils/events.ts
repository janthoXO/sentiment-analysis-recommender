import { EventEmitter } from "events";
import type { SourceResultRoot } from "../generated/in/index.js";

export const sentimentEmitter = new EventEmitter();

export interface SourceUpdateEvent {
  ticker: string;
  source: SourceResultRoot;
}
