import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') || '';
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: profile } = await admin.from('profiles').select('role,status').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'super_admin' || profile?.status !== 'active') return new Response(JSON.stringify({ error: 'Active super-admin role required' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    const body = await req.json(); const action = String(body.action || '');
    if (action === 'create') {
      const email = String(body.email || '').trim().toLowerCase(); const password = String(body.password || '');
      if (!email.includes('@') || password.length < 12) return new Response(JSON.stringify({ error: 'Valid email and a password of at least 12 characters are required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: String(body.display_name || '').slice(0,120) } });
      if (error || !data.user) throw error || new Error('Account creation failed');
      const { error: pError } = await admin.from('profiles').upsert({ id: data.user.id, email, role: 'admin', display_name: String(body.display_name || '').slice(0,120) || null, business_name: String(body.business_name || '').slice(0,160) || null, phone: String(body.phone || '').slice(0,40) || null, status: 'active' });
      if (pError) { await admin.auth.admin.deleteUser(data.user.id); throw pError; }
      await admin.from('audit_logs').insert({ actor_id: user.id, actor_email: user.email, actor_role: 'super_admin', action: 'admin_created', target_type: 'auth_user', target_id: data.user.id, details: { email, business_name: String(body.business_name || '').slice(0,160) } });
      return new Response(JSON.stringify({ ok: true, user_id: data.user.id, email }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const id = String(body.user_id || ''); if (!id || id === user.id) return new Response(JSON.stringify({ error: 'A valid other user ID is required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    const { data: existingTarget } = await admin.from('profiles').select('role').eq('id', id).maybeSingle();
    if (!existingTarget) return new Response(JSON.stringify({ error: 'Account not found' }), { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (existingTarget.role === 'super_admin' && action !== 'update') return new Response(JSON.stringify({ error: 'Super-admin accounts cannot be deleted here' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (action === 'update') {
      if (existingTarget.role === 'super_admin' && body.status && body.status !== 'active') return new Response(JSON.stringify({ error: 'Super-admin status cannot be suspended through this endpoint' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
      if (existingTarget.role === 'super_admin' && body.role && body.role !== 'super_admin') return new Response(JSON.stringify({ error: 'Super-admin role cannot be changed through this endpoint' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
      if (body.password !== undefined && String(body.password).length < 12) return new Response(JSON.stringify({ error: 'New password must be at least 12 characters' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
      const patch: Record<string, unknown> = {};
      for (const k of ['display_name','business_name','phone']) if (k in body) patch[k] = String(body[k] || '').slice(0, k === 'phone' ? 40 : 160) || null;
      if (body.role === 'admin' || body.role === 'customer') patch.role = body.role;
      if (body.status === 'active' || body.status === 'suspended' || body.status === 'pending') patch.status = body.status;
      const { error } = await admin.from('profiles').update(patch).eq('id', id); if (error) throw error;
      if (typeof body.password === 'string' && body.password.length >= 12) { const { error: e } = await admin.auth.admin.updateUserById(id, { password: body.password }); if (e) throw e; }
      await admin.from('audit_logs').insert({ actor_id: user.id, actor_email: user.email, actor_role: 'super_admin', action: 'admin_updated', target_type: 'auth_user', target_id: id, details: { fields: Object.keys(patch), password_reset: Boolean(body.password) } });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    if (action === 'delete') {
      const { data: target } = await admin.from('profiles').select('role').eq('id', id).maybeSingle();
      if (target?.role === 'super_admin') return new Response(JSON.stringify({ error: 'Cannot delete a super-admin account through this endpoint' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
      await admin.from('audit_logs').insert({ actor_id: user.id, actor_email: user.email, actor_role: 'super_admin', action: 'admin_deleted', target_type: 'auth_user', target_id: id, details: { target_role: target?.role || null } });
      const { error } = await admin.auth.admin.deleteUser(id); if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'Unsupported action' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) { return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Admin operation failed' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }); }
});
