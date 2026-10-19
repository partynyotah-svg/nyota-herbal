-- Nyota Marketplace commerce upgrade. Apply after schema.sql in Supabase SQL Editor.
create extension if not exists pgcrypto;
alter table public.customer_inquiries add column if not exists product_id uuid references public.products(id) on delete set null;
alter table public.customer_inquiries add column if not exists inquiry_type text not null default 'product' check (inquiry_type in ('product','general','order'));
alter table public.customer_inquiries add column if not exists admin_response text;
alter table public.customer_inquiries add column if not exists responded_at timestamptz;

create table if not exists public.orders (
 id uuid primary key default gen_random_uuid(), order_number text not null unique default ('NY-' || upper(substr(encode(gen_random_bytes(6),'hex'),1,10))),
 customer_name text not null check(length(customer_name) between 1 and 160), phone text not null check(length(phone) between 5 and 40), email text,
 delivery_address text not null check(length(delivery_address) between 5 and 1000), delivery_notes text,
 status text not null default 'pending' check(status in ('pending','confirmed','processing','shipped','delivered','cancelled')),
 payment_status text not null default 'pending' check(payment_status in ('pending','received','failed','refunded')),
 payment_method text not null default 'pay_on_delivery' check(payment_method in ('pay_on_delivery','mpesa','bank_transfer','other')),
 subtotal numeric(12,2) not null default 0 check(subtotal>=0), currency text not null default 'KES', customer_id uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), delivered_at timestamptz
);
create table if not exists public.order_items (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
 product_id uuid references public.products(id) on delete set null, owner_id uuid references public.profiles(id) on delete set null,
 product_name text not null, unit_price numeric(12,2) not null check(unit_price>=0), quantity integer not null check(quantity between 1 and 1000), line_total numeric(12,2) not null check(line_total>=0), created_at timestamptz not null default now()
);
create index if not exists orders_created_idx on public.orders(created_at desc);
create index if not exists orders_status_idx on public.orders(status,payment_status);
create index if not exists order_items_owner_idx on public.order_items(owner_id,created_at desc);
alter table public.orders enable row level security; alter table public.order_items enable row level security;
drop policy if exists "super admins manage orders" on public.orders;
create policy "super admins manage orders" on public.orders for all to authenticated using(public.current_role()='super_admin') with check(public.current_role()='super_admin');
drop policy if exists "admins see orders containing own products" on public.orders;
create policy "admins see orders containing own products" on public.orders for select to authenticated using(public.current_role()='admin' and exists(select 1 from public.order_items i where i.order_id=orders.id and i.owner_id=auth.uid()));
drop policy if exists "super admins manage order items" on public.order_items;
create policy "super admins manage order items" on public.order_items for all to authenticated using(public.current_role()='super_admin') with check(public.current_role()='super_admin');
drop policy if exists "admins read own order items" on public.order_items;
create policy "admins read own order items" on public.order_items for select to authenticated using(public.current_role()='admin' and owner_id=auth.uid());

-- Public checkout is atomic: validates products and stock, reserves inventory, then creates order.
create or replace function public.create_public_order(p_customer_name text,p_phone text,p_email text,p_delivery_address text,p_delivery_notes text,p_payment_method text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_order public.orders; v_item jsonb; v_product public.products; v_qty int; v_total numeric(12,2):=0; v_owner uuid; v_price numeric(12,2);
begin
 if length(trim(coalesce(p_customer_name,''))) not between 1 and 160 then raise exception 'Enter a valid customer name'; end if;
 if length(trim(coalesce(p_phone,''))) not between 5 and 40 then raise exception 'Enter a valid phone number'; end if;
 if length(trim(coalesce(p_delivery_address,''))) not between 5 and 1000 then raise exception 'Enter a delivery address'; end if;
 if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>50 then raise exception 'Cart is empty or too large'; end if;
 -- Lock product rows in deterministic UUID order to reduce checkout race conditions.
 for v_item in select value from jsonb_array_elements(p_items) order by (value->>'product_id') loop
   v_qty := greatest(1,least(1000,coalesce((v_item->>'quantity')::int,1)));
   select * into v_product from public.products where id=(v_item->>'product_id')::uuid and active=true for update;
   if not found then raise exception 'A product is no longer available'; end if;
   if v_product.price is null then raise exception 'A product needs a confirmed price before checkout'; end if;
   if v_product.stock_quantity < v_qty then raise exception 'Insufficient stock for %',v_product.name; end if;
   v_total := v_total + v_product.price*v_qty;
 end loop;
 insert into public.orders(customer_name,phone,email,delivery_address,delivery_notes,payment_method,subtotal,customer_id)
 values(trim(p_customer_name),trim(p_phone),nullif(trim(coalesce(p_email,'')),''),trim(p_delivery_address),nullif(trim(coalesce(p_delivery_notes,'')),''),case when p_payment_method in ('pay_on_delivery','mpesa','bank_transfer','other') then p_payment_method else 'pay_on_delivery' end,v_total,auth.uid()) returning * into v_order;
 for v_item in select value from jsonb_array_elements(p_items) loop
   v_qty := greatest(1,least(1000,coalesce((v_item->>'quantity')::int,1)));
   select * into v_product from public.products where id=(v_item->>'product_id')::uuid and active=true for update;
   update public.products set stock_quantity=stock_quantity-v_qty, updated_at=now() where id=v_product.id;
   insert into public.order_items(order_id,product_id,owner_id,product_name,unit_price,quantity,line_total)
   values(v_order.id,v_product.id,v_product.owner_id,v_product.name,v_product.price,v_qty,v_product.price*v_qty);
 end loop;
 return jsonb_build_object('id',v_order.id,'order_number',v_order.order_number,'subtotal',v_order.subtotal,'status',v_order.status,'payment_status',v_order.payment_status);
end; $$;
revoke all on function public.create_public_order(text,text,text,text,text,text,jsonb) from public;
grant execute on function public.create_public_order(text,text,text,text,text,text,jsonb) to anon,authenticated;

-- Only super-admins may update order/payment state from the console. Payment providers should update via a verified webhook.
create or replace function public.set_order_state(p_order_id uuid,p_status text,p_payment_status text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 if public.current_role() <> 'super_admin' then raise exception 'Super administrator required'; end if;
 if p_status not in ('pending','confirmed','processing','shipped','delivered','cancelled') then raise exception 'Invalid order status'; end if;
 if p_payment_status is not null and p_payment_status not in ('pending','received','failed','refunded') then raise exception 'Invalid payment status'; end if;
 update public.orders set status=p_status,payment_status=coalesce(p_payment_status,payment_status),updated_at=now(),delivered_at=case when p_status='delivered' then coalesce(delivered_at,now()) else delivered_at end where id=p_order_id;
 if not found then raise exception 'Order not found'; end if;
end; $$;
revoke all on function public.set_order_state(uuid,text,text) from public;
grant execute on function public.set_order_state(uuid,text,text) to authenticated;

-- Public can submit enquiries; only super-admin can see and respond. Product owner is stored separately for routing context.
drop policy if exists "seller read own inquiries super all" on public.customer_inquiries;
drop policy if exists "seller update own inquiries super all" on public.customer_inquiries;
create policy "super admin reads all inquiries" on public.customer_inquiries for select to authenticated using(public.current_role()='super_admin');
create policy "super admin responds to inquiries" on public.customer_inquiries for update to authenticated using(public.current_role()='super_admin') with check(public.current_role()='super_admin');
alter table public.orders add column if not exists mpesa_checkout_request_id text unique;
alter table public.orders add column if not exists mpesa_merchant_request_id text;
alter table public.orders add column if not exists mpesa_receipt_number text;
alter table public.orders add column if not exists payment_reference text;
alter table public.products add column if not exists seller_business_name text;
alter table public.products add column if not exists seller_contact_name text;
alter table public.products add column if not exists seller_contact_phone text;
-- Keep public product cards usable without exposing the private profiles table. Sellers can choose the phone shown on each listing.
update public.products p set seller_business_name=coalesce(p.seller_business_name,pr.business_name),seller_contact_name=coalesce(p.seller_contact_name,pr.display_name),seller_contact_phone=coalesce(p.seller_contact_phone,pr.phone) from public.profiles pr where p.owner_id=pr.id;
-- Enable realtime order updates in the super-admin dashboard when the publication exists.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders') then
  alter publication supabase_realtime add table public.orders;
 end if;
end $$;
alter table public.customer_inquiries add column if not exists whatsapp_notified_at timestamptz;
alter table public.orders add column if not exists whatsapp_notified_at timestamptz;
