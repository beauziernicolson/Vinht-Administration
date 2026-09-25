// Configuration publique VinHT (frontend).
//
// La clé "publishable" Supabase est PUBLIQUE par conception : elle est
// observable dans le navigateur sur toute page déployée, et protégée par les
// RLS du backend. La stocker ici (plutôt que .env.local, inutilisable sans
// bundler) est le choix assumé.
//
// NE JAMAIS mettre ici : service_role, database password, JWT signing secret,
// FlexiCash/FlexiCard secret, webhook secret, admin token, ou tout credential privé.

export const SUPABASE_URL = "https://dabgchjcbxgtnntamerx.supabase.co";

// Clé publishable moderne (par défaut).
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kH-2s1GQxH7mZECj-KfCOA_V4n31bTU";
