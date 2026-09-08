CREATE TYPE "public"."review_invite_role" AS ENUM('outside_reviewer', 'campaign_contact');--> statement-breakpoint
ALTER TYPE "public"."actor_type" ADD VALUE 'reviewer';--> statement-breakpoint
CREATE TABLE "review_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"stage" "project_status" NOT NULL,
	"role" "review_invite_role" NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_name" text DEFAULT '' NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "review_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "review_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_responses_invite_id_version_id_unique" UNIQUE("invite_id","version_id"),
	CONSTRAINT "review_responses_decision_check" CHECK ("review_responses"."decision" in ('approved','issues'))
);
--> statement-breakpoint
ALTER TABLE "review_invites" ADD CONSTRAINT "review_invites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_invite_id_review_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."review_invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_version_id_submission_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."submission_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_review_invites_project" ON "review_invites" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_review_responses_project" ON "review_responses" USING btree ("project_id");