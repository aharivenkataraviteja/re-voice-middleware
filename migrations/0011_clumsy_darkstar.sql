CREATE TYPE "public"."calendar_connection_status" AS ENUM('connected', 'disconnected', 'error');--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"google_account_email" text,
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"refresh_token_encrypted" text,
	"status" "calendar_connection_status" DEFAULT 'disconnected' NOT NULL,
	"last_error" text,
	"connected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "google_event_id" text;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connections_tenant_agent_unique" ON "calendar_connections" USING btree ("tenant_id","agent_id");