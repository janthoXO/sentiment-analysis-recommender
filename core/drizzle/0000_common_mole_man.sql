CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"scan_job_id" uuid NOT NULL,
	"url" text,
	"snippet" text,
	"score" numeric(4, 3),
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_scores" (
	"ticker" text PRIMARY KEY NOT NULL,
	"avg_score" numeric(4, 3),
	"article_count" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stocks" (
	"ticker" text PRIMARY KEY NOT NULL,
	"figi" text NOT NULL,
	"name" text,
	CONSTRAINT "stocks_figi_unique" UNIQUE("figi")
);
--> statement-breakpoint
CREATE INDEX "idx_articles_ticker" ON "articles" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "idx_articles_scan_job_id" ON "articles" USING btree ("scan_job_id");