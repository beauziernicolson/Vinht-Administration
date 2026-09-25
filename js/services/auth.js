// Service d'authentification VinHT (wrapper mince autour de supabase.auth).
// Signup / login / logout / session. Aucune logique métier ici.

import { getSupabase, isSupabaseConfigured } from "./supabase.js";

export { isSupabaseConfigured };

const AUTH_RETURN_URL_KEY = "vinht-auth-return-url";

function requireClient() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  return sb;
}

function safeReturnUrl(candidate) {
  try {
    const url = new URL(candidate, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    // Les fragments peuvent contenir des jetons OAuth temporaires : Supabase
    // les gère au retour, ils ne doivent jamais être inclus dans redirectTo.
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

// Toute page qui ouvre la modale enregistre son URL complète. Le stockage de
// session survit au détour OAuth, sans créer de redirection externe ouverte.
export function rememberAuthReturnUrl(url = window.location.href) {
  const safe = safeReturnUrl(url);
  if (!safe) return;
  try { sessionStorage.setItem(AUTH_RETURN_URL_KEY, safe); } catch {}
}

export function getAuthReturnUrl() {
  let stored = null;
  try { stored = sessionStorage.getItem(AUTH_RETURN_URL_KEY); } catch {}
  return safeReturnUrl(stored) || safeReturnUrl(window.location.href) || window.location.origin;
}

export async function signUp({ email, password, fullName }) {
  const sb = requireClient();
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getAuthReturnUrl(),
      data: fullName ? { full_name: fullName } : undefined,
    },
  });
  if (error) throw error;
  return data;
}

export async function signIn({ email, password }) {
  const sb = requireClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// OAuth Google. Aucun secret client dans le frontend (géré côté Google + Supabase).
// Déclenche une redirection plein écran ; au retour, detectSessionInUrl gère la session.
export async function signInWithGoogle() {
  const sb = requireClient();
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: getAuthReturnUrl() },
  });
  if (error) throw error;
  return data;
}

// #36C — envoi d'un lien magique à l'adresse d'un futur marchand (dossier
// Agent). N'affecte jamais la session courante : signInWithOtp se contente de
// déclencher l'envoi de l'e-mail à Supabase, la session locale ne change
// qu'au moment où le lien reçu est effectivement ouvert (sur l'appareil du
// destinataire). Aucun mot de passe, code ou jeton ne transite par ce wrapper.
export async function signInWithOtpToEmail(email, { redirectTo, shouldCreateUser = true } = {}) {
  const sb = requireClient();
  const { data, error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser, emailRedirectTo: redirectTo || undefined },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session ?? null;
}

export async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

// Retourne une fonction pour se désabonner.
export function onAuthChange(callback) {
  const sb = getSupabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}
