// Append an entry to the audit log. Never throws: a logging failure must not block the action.
export async function audit(env, actor, action, entity, entityId, detail) {
  try {
    await env.DB.prepare(
      'INSERT INTO audit_log (actor_user_id, actor_email, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)'
    )
      .bind(actor?.id ?? null, actor?.email ?? null, action, entity ?? null, entity == null ? null : String(entityId ?? ''), detail ? JSON.stringify(detail) : null)
      .run();
  } catch (err) {
    console.error('audit failed', err);
  }
}
