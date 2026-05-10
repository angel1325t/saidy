import { supabaseAdmin } from './supabase.js';

export type AuditEvent = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logAuditEvent(event: AuditEvent) {
  const { error } = await supabaseAdmin.from('audit_logs').insert({
    actor_id: event.actorId,
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId ?? null,
    metadata: event.metadata ?? {}
  });

  if (error) {
    throw new Error(error.message);
  }
}

