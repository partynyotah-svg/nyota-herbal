import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const clean = (v: unknown, max = 500) => String(v ?? '').replace(/[<>]/g, '').slice(0, max);
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const destination = Deno.env.get('SUPER_ADMIN_WHATSAPP');
  const version = Deno.env.get('WHATSAPP_API_VERSION') || 'v23.0';
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!token || !phoneId || !destination || !supabaseUrl || !serviceKey) return new Response(JSON.stringify({ ok: false, skipped: true, message: 'WhatsApp secrets are not configured.' }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    const body = await req.json();
    const type = clean(body.type, 40);
    const db = (await import('https://esm.sh/@supabase/supabase-js@2')).createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let message = '';
    let targetTable = '';
    let targetId = '';
    if (type === 'product_inquiry') {
      targetId = clean(body.inquiry_id, 80); targetTable = 'customer_inquiries';
      if (!targetId) throw new Error('Inquiry ID required');
      const { data: inquiry, error } = await db.from('customer_inquiries').select('id,customer_name,phone,message,product_id,whatsapp_notified_at').eq('id', targetId).maybeSingle();
      if (error || !inquiry) throw new Error('Inquiry not found');
      if (inquiry.whatsapp_notified_at) return new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
      let productName = 'General product question';
      if (inquiry.product_id) { const { data: product } = await db.from('products').select('name').eq('id', inquiry.product_id).maybeSingle(); if (product?.name) productName = product.name; }
      message = `NYOTA MARKETPLACE — PRODUCT ENQUIRY\nCustomer: ${clean(inquiry.customer_name,160)}\nPhone: ${clean(inquiry.phone,40)}\nProduct: ${clean(productName,160)}\nMessage: ${clean(inquiry.message,1800)}\nInquiry ID: ${clean(inquiry.id,80)}\nOpen the Super Admin dashboard to review and respond manually.`;
    } else if (type === 'new_order') {
      const orderNumber = clean(body.order_number, 80); targetTable = 'orders';
      if (!orderNumber) throw new Error('Order number required');
      const { data: order, error } = await db.from('orders').select('id,order_number,customer_name,phone,subtotal,whatsapp_notified_at').eq('order_number', orderNumber).maybeSingle();
      if (error || !order) throw new Error('Order not found');
      targetId = order.id;
      if (order.whatsapp_notified_at) return new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
      const { data: lines } = await db.from('order_items').select('product_name,quantity').eq('order_id', order.id).limit(20);
      const items = (lines || []).map((i: any) => `${clean(i.product_name,100)} x${Math.max(1, Math.min(1000, Number(i.quantity)||1))}`).join(', ') || 'See dashboard';
      message = `NYOTA MARKETPLACE — NEW ORDER\nOrder: ${clean(order.order_number,80)}\nCustomer: ${clean(order.customer_name,160)}\nPhone: ${clean(order.phone,40)}\nSubtotal: KES ${clean(order.subtotal,30)}\nItems: ${items}\nPayment is NOT confirmed by this alert; verify payment separately.`;
    } else return new Response(JSON.stringify({ error: 'Unsupported notification type' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    // For production, configure an approved WhatsApp template for business-initiated messages when required by Meta policy.
    const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: destination, type: 'text', text: { preview_url: false, body: message } })
    });
    const result = await response.json();
    if (!response.ok) return new Response(JSON.stringify({ ok: false, error: result?.error?.message || 'WhatsApp provider rejected the message' }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (targetTable === 'customer_inquiries') await db.from('customer_inquiries').update({ whatsapp_notified_at: new Date().toISOString() }).eq('id', targetId);
    if (targetTable === 'orders') await db.from('orders').update({ whatsapp_notified_at: new Date().toISOString() }).eq('id', targetId);
    return new Response(JSON.stringify({ ok: true, message_id: result?.messages?.[0]?.id || null }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (_e) { return new Response(JSON.stringify({ error: 'Invalid request or notification failed' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }); }
});
