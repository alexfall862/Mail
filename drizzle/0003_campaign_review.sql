ALTER TYPE "public"."project_status" ADD VALUE 'campaign_review' BEFORE 'legal_review';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "campaign_contact_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "campaign_contact_email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "campaign_contact_phone" text;