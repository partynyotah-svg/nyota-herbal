import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const env = (k: string) => Deno.env.get(k) || '';
const normalizePhone = (v: string) => { const digits=v.replace(/\D/g,''); if(digits.startsWith('254')&&digits.length===12)return digits; if(digits.startsWith('0')&&digits.length===10)return '254'+digits.slice(1); if(digits.length===9&&digits.startsWith('7'))return '254'+digits; throw new Error('Enter a valid Kenyan M-Pesa phone number'); };
serve(async (req) => {
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 const url=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY');
 try {
  const body=await req.json(); const orderId=String(body.order_id||''); const phone=normalizePhone(String(body.phone||''));
  if(!orderId)throw new Error('Order ID required');
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:order,error}=await admin.from('orders').select('*').eq('id',orderId).maybeSingle(); if(error||!order)throw new Error('Order not found');
  if(order.payment_method!=='mpesa'||order.payment_status!=='pending')throw new Error('Order is not awaiting M-Pesa payment');
  if(normalizePhone(String(order.phone))!==phone)throw new Error('M-Pesa phone must match the phone number used for this order');
  const key=env('MPESA_CONSUMER_KEY'),secret=env('MPESA_CONSUMER_SECRET'),shortcode=env('MPESA_SHORTCODE'),passkey=env('MPESA_PASSKEY'),callback=env('MPESA_CALLBACK_URL');
  if(!key||!secret||!shortcode||!passkey||!callback)throw new Error('M-Pesa Daraja secrets are not configured');
  const base=env('MPESA_ENV')==='production'?'https://api.safaricom.co.ke':'https://sandbox.safaricom.co.ke';
  const auth=await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`,{headers:{Authorization:`Basic ${btoa(`${key}:${secret}`)}`}});const authJson=await auth.json();if(!auth.ok||!authJson.access_token)throw new Error('Could not authenticate with M-Pesa Daraja');
  const timestamp=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14);const password=btoa(`${shortcode}${passkey}${timestamp}`);
  const amount=Math.max(1,Math.ceil(Number(order.subtotal)));const result=await fetch(`${base}/mpesa/stkpush/v1/processrequest`,{method:'POST',headers:{Authorization:`Bearer ${authJson.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({BusinessShortCode:shortcode,Password:password,Timestamp:timestamp,TransactionType:env('MPESA_TRANSACTION_TYPE')||'CustomerPayBillOnline',Amount:amount,PartyA:phone,PartyB:shortcode,PhoneNumber:phone,CallBackURL:callback,AccountReference:String(order.order_number).slice(0,12),TransactionDesc:`Nyota order ${order.order_number}`.slice(0,20)})});
  const data=await result.json();if(!result.ok||Number(data.ResponseCode)!==0)throw new Error(data.errorMessage||data.ResponseDescription||'M-Pesa STK push failed');
  await admin.from('orders').update({mpesa_checkout_request_id:data.CheckoutRequestID,mpesa_merchant_request_id:data.MerchantRequestID,payment_reference:data.CheckoutRequestID,updated_at:new Date().toISOString()}).eq('id',orderId);
  return new Response(JSON.stringify({ok:true,customer_message:data.CustomerMessage||'Check your phone and enter your M-Pesa PIN to complete payment.'}),{headers:{...cors,'Content-Type':'application/json'}});
 } catch(e){return new Response(JSON.stringify({error:e instanceof Error?e.message:'M-Pesa request failed'}),{status:400,headers:{...cors,'Content-Type':'application/json'}})}
});
