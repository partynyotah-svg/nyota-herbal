import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const env=(k:string)=>Deno.env.get(k)||'';
serve(async(req)=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const secret=env('MPESA_CALLBACK_SECRET');const supplied=new URL(req.url).searchParams.get('secret');if(!secret||supplied!==secret)return new Response('Not authorized',{status:401});
 try{
  const payload=await req.json();const cb=payload?.Body?.stkCallback;if(!cb?.CheckoutRequestID)return new Response(JSON.stringify({ResultCode:0,ResultDesc:'Ignored'}),{headers:{'Content-Type':'application/json'}});
  const admin=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:order}=await admin.from('orders').select('id,subtotal').eq('mpesa_checkout_request_id',cb.CheckoutRequestID).maybeSingle();if(!order)return new Response(JSON.stringify({ResultCode:0,ResultDesc:'Order not matched'}),{headers:{'Content-Type':'application/json'}});
  const resultCode=Number(cb.ResultCode);const items=cb.CallbackMetadata?.Item||[];const get=(name:string)=>items.find((x:any)=>x.Name===name)?.Value;const receipt=get('MpesaReceiptNumber');const amount=Number(get('Amount')||0);
  if(resultCode===0&&amount>=Number(order.subtotal)){
   await admin.from('orders').update({payment_status:'received',payment_reference:String(receipt||cb.CheckoutRequestID),mpesa_receipt_number:receipt?String(receipt):null,updated_at:new Date().toISOString()}).eq('id',order.id);
  }else if(resultCode!==0){await admin.from('orders').update({payment_status:'failed',updated_at:new Date().toISOString()}).eq('id',order.id)}
  return new Response(JSON.stringify({ResultCode:0,ResultDesc:'Accepted'}),{headers:{'Content-Type':'application/json'}});
 }catch(_e){return new Response(JSON.stringify({ResultCode:0,ResultDesc:'Accepted for reconciliation'}),{headers:{'Content-Type':'application/json'}})}
});
