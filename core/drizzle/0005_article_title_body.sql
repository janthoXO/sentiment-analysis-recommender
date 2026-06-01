-- Replace the single "snippet" column with explicit "title" and "body" columns.
-- Existing rows are preserved: snippet is split on the first newline.
--> statement-breakpoint
ALTER TABLE "source_score" ADD COLUMN "title" text;
--> statement-breakpoint
ALTER TABLE "source_score" ADD COLUMN "body" text;
--> statement-breakpoint
UPDATE "source_score"
SET
  title = split_part(snippet, E'\n', 1),
  body  = CASE
            WHEN strpos(snippet, E'\n') > 0
            THEN substring(snippet FROM strpos(snippet, E'\n') + 1)
            ELSE ''
          END;
--> statement-breakpoint
ALTER TABLE "source_score" ALTER COLUMN "title" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "source_score" ALTER COLUMN "body" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "source_score" DROP COLUMN "snippet";
