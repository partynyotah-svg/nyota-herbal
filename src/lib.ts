import {createClient} from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL as string|undefined; const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
export const configured=Boolean(url&&key&&!url.includes('YOUR_PROJECT')); export const supabase=configured?createClient(url!,key!):null;
export const TIKTOK_URL='https://vm.tiktok.com/ZMkVArvD7/'; export const WHATSAPP_CATALOG_URL='https://wa.me/c/254722566509'; export const WHATSAPP_NUMBER='254722566509';
