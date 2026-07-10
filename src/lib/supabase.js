import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigMissing = !supabaseUrl || !supabaseAnonKey;

const browserSessionStorage = typeof window === "undefined" ? undefined : {
  getItem(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // Supabase can continue without persistence if the browser blocks sessionStorage.
    }
  },
  removeItem(key) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Best effort cleanup.
    }
  },
};

export const supabase = supabaseConfigMissing ? null : createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: browserSessionStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
