ALTER TABLE "tracker" DROP COLUMN "name";
--> statement-breakpoint
ALTER TABLE "tracker" ADD CONSTRAINT "tracker_ticker_ticker_stock_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."ticker_stock"("ticker") ON DELETE no action ON UPDATE no action;
