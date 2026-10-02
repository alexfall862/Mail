ALTER TABLE "review_invites" ADD COLUMN "token_encrypted" text;--> statement-breakpoint
ALTER TABLE "review_invites" ADD COLUMN "reminder_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_invites" ADD COLUMN "last_reminded_at" timestamp with time zone;