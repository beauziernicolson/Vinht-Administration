// Client Supabase unique et partagé.
//
// - URL + clé publishable publique uniquement (voir js/config.js).
// - Aucune clé service_role.
// - RLS respectée : le frontend n'utilise que l'API publique.
//
// Le SDK est chargé en ESM depuis esm.sh (pas de build system dans ce projet).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";

let client = null;

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

export function getSupabase() {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
