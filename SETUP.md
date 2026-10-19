# Nyota Herbal & Natural Wellness — Hyper Marketplace

React + TypeScript + Vite storefront, Supabase Auth/Postgres/Storage, Supabase Edge Functions, and Vercel deployment configuration.

## What this version adds

- Modern responsive storefront, search/category filtering, product owner/business contact details, direct seller WhatsApp link, and a separate **Ask super admin** product enquiry path.
- Multi-seller product ownership. Each product stores a public seller/business contact snapshot; product inquiries are recorded for the super-admin inbox, not routed to a different seller accidentally.
- Basket and checkout. The database RPC validates stock and pricing, reserves stock atomically, and creates an order with a unique order number.
- Super-admin order dashboard with separate fulfilment and payment statuses. Status options include pending, confirmed, processing, shipped, delivered, cancelled, and payment pending/received/failed/refunded.
- Optional M-Pesa Daraja STK Push integration scaffold. A successful verified callback updates payment status and receipt reference. Credentials and live/sandbox setup are required before this is operational.
- WhatsApp Business Cloud API notification function for product inquiries and new orders. Messages go to the configured super-admin WhatsApp destination. The customer is **not automatically sent a reply**; staff can save an internal response from the inquiry inbox.
- Super-admin admin creation, profile/business/contact editing, account status changes, password reset-by-setting-a-new-password, account deletion, read-only workspace preview, platform products, audit events and inquiry review. Existing passwords are never visible.
- Device theme synchronization through `prefers-color-scheme` dark/light styles.
- Staff login button is hidden from the public header/footer. Open the restricted staff sign-in modal with **Ctrl + Shift + L**. This is only a discreet entry point, not a security boundary; actual protection comes from Supabase authentication, RLS and role checks.
- Vite TypeScript declarations in `src/vite-env.d.ts`.

## Required setup

1. Use Node.js 20 LTS or later and create/configure your Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL Editor first.
3. Run `supabase/commerce-enhancement.sql` after the base schema. This adds order, payment, seller-contact, inquiry-response columns and secure checkout/status RPCs.
4. Copy `.env.example` to `.env` for local development. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Do not commit `.env` and never prefix a service-role key with `VITE_`.
5. Create initial staff accounts with the provided `npm run seed:admins` script and unique temporary passwords. Sign in and change passwords immediately.
6. Install and test: `npm install`, `npm run build`, then `npm run dev`.

## Deploy Edge Functions

Install and authenticate the Supabase CLI, link the project, then deploy:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy notify-superadmin
supabase functions deploy admin-users
supabase functions deploy mpesa-stk-push
supabase functions deploy mpesa-callback --no-verify-jwt
```

Set Edge Function secrets in the Supabase dashboard or with `supabase secrets set`. Never add these secrets to Vite environment variables:

### WhatsApp Business Cloud API

- `WHATSAPP_ACCESS_TOKEN` — long-lived/system-user access token with permission to send WhatsApp messages.
- `WHATSAPP_PHONE_NUMBER_ID` — WhatsApp Business phone-number ID (not the visible phone number).
- `SUPER_ADMIN_WHATSAPP` — super-admin recipient in international digits, e.g. `2547XXXXXXXX`.
- Optional `WHATSAPP_API_VERSION` — Graph API version enabled for your Meta app.

Meta may require an approved WhatsApp message template for business-initiated messages outside the customer-service window. Test with a verified recipient first. The function reports provider errors; successful order/enquiry database records remain saved even if WhatsApp is not configured.

### M-Pesa Daraja (optional)

- `MPESA_ENV` — `sandbox` first; use `production` only after credentials and testing are approved.
- `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`
- `MPESA_SHORTCODE`, `MPESA_PASSKEY`
- `MPESA_CALLBACK_SECRET` — long random secret used in the callback URL query string.
- `MPESA_CALLBACK_URL` — public deployed callback URL, for example `https://YOUR_PROJECT_REF.supabase.co/functions/v1/mpesa-callback?secret=YOUR_LONG_RANDOM_SECRET`.
- Optional `MPESA_TRANSACTION_TYPE` — normally `CustomerPayBillOnline` for a PayBill flow; configure according to your Daraja shortcode type.

Use the Daraja sandbox first with test credentials. Only successful callbacks matched to the stored checkout request and expected amount set `payment_status=received`. A checkout or customer prompt by itself is not proof of payment. Reconcile production transactions and test callbacks before accepting live payments.

## Vercel deployment

Import the repository into Vercel. Framework: Vite; Build Command: `npm run build`; Output Directory: `dist`. Add only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as frontend environment variables. Redeploy after changing them. If your Vercel deployment returns 404, open the latest deployment from Vercel Dashboard → Deployments → **Visit**.

## Account-management security

`admin-users` is a protected Edge Function and checks the caller's active `super_admin` profile before using the service-role client. Existing passwords cannot be retrieved; super-admins can set a new password instead. Workspace preview is read-only and does not impersonate an administrator session. Review and audit all account changes in production; enable MFA for privileged accounts and restrict access to Supabase project settings.

## Important production limits

- The integrations are code-ready scaffolds, not proof that your external Meta or Safaricom accounts have been configured. No real WhatsApp message or M-Pesa payment can occur until valid provider credentials, approved settings and callback URLs are supplied.
- Orders and stock reservation are implemented in SQL. Delivery is marked delivered only when an authorized staff member changes the order status; connect your actual courier/tracking API if delivery confirmation must be automatic.
- Payment is not automatically marked received for pay-on-delivery or bank transfer. M-Pesa can be automatically reconciled through the configured callback; other payment methods need their own verified provider webhook or manual reconciliation.
- Before broad commercial launch, add CAPTCHA/rate limiting, transactional email, data-retention policies, monitoring/alerts, automated tests, provider sandbox tests, and review the Supabase RLS policies with test accounts. Confirm Kenyan legal, consumer-protection, privacy, tax, and product-labeling requirements.

## Responsible wellness

List accurate ingredients/botanical names, source, quantity, directions, warnings and batch/expiry information where relevant. Avoid unsupported cure claims. The marketplace does not diagnose, treat, cure or prevent disease.

TikTok: https://vm.tiktok.com/ZMkVArvD7/
WhatsApp catalogue: https://wa.me/c/254722566509
