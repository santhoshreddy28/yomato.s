// Cloud mode switches on automatically when both env vars are set (see .env.example).
// Without them the app runs in the original single-browser demo mode.
import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const CLOUD = !!(url && key);
export const sb = CLOUD ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
