CREATE TABLE "tracker" (
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"priority" integer NOT NULL,
	"expires_at" bigint,
	"interval" bigint NOT NULL,
	"last_triggered_at" bigint,
	CONSTRAINT "tracker_ticker_priority_interval_pk" PRIMARY KEY("ticker","priority","interval")
);
