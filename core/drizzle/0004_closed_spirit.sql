CREATE TABLE "user_ticker_access" (
	"user_id" text NOT NULL,
	"ticker" text NOT NULL,
	"last_accessed_sec" integer NOT NULL,
	CONSTRAINT "user_ticker_access_user_id_ticker_pk" PRIMARY KEY("user_id","ticker")
);
--> statement-breakpoint
ALTER TABLE "source_score" ALTER COLUMN "score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_ticker_access" ADD CONSTRAINT "user_ticker_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker" ADD CONSTRAINT "tracker_ticker_ticker_stock_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."ticker_stock"("ticker") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker" DROP COLUMN "name";