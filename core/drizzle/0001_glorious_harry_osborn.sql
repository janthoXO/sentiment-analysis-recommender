CREATE TABLE "list_items" (
	"list_id" text NOT NULL,
	"ticker" text NOT NULL,
	CONSTRAINT "list_items_list_id_ticker_pk" PRIMARY KEY("list_id","ticker")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at_sec" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_score" (
	"ticker" text NOT NULL,
	"url" text NOT NULL,
	"snippet" text NOT NULL,
	"updated_at_sec" bigint NOT NULL,
	"scraped_at_sec" bigint NOT NULL,
	"score" real NOT NULL,
	CONSTRAINT "source_score_ticker_url_pk" PRIMARY KEY("ticker","url")
);
--> statement-breakpoint
CREATE TABLE "ticker_stock" (
	"ticker" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_score" ADD CONSTRAINT "source_score_ticker_ticker_stock_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."ticker_stock"("ticker") ON DELETE no action ON UPDATE no action;