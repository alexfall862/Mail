/** Append a row to the events audit trail (SPEC §4). */
import { events } from "@/db/schema";
import type { Db, Tx } from "@/db";

export type EventActor = "admin" | "vendor" | "system";

export async function logEvent(
  db: Db | Tx,
  entry: {
    projectId: string | null;
    actor: EventActor;
    actorId?: string | null;
    eventType: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(events).values({
    projectId: entry.projectId,
    actor: entry.actor,
    actorId: entry.actorId ?? null,
    eventType: entry.eventType,
    payload: entry.payload ?? {},
  });
}
