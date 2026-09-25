import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";

async function authed() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const session = await getSession();
  if (!session?.user) throw new Error("not-authenticated");
  return { sb, user: session.user };
}

const PROFILE_FIELDS =
  "id,full_name,email,phone,address,avatar_url,notifications_enabled,whatsapp_updates,commerce_environment,created_at,updated_at";

export async function getMyProfile() {
  const { sb, user } = await authed();
  const { data, error } = await sb
    .from("profiles")
    .select(PROFILE_FIELDS)
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function updateMyProfile(input = {}) {
  const { sb, user } = await authed();
  const allowed = {};
  for (const [key, value] of Object.entries({
    full_name: input.fullName,
    phone: input.phone,
    address: input.address,
    notifications_enabled: input.notificationsEnabled,
    whatsapp_updates: input.whatsappUpdates,
  })) {
    if (value !== undefined) allowed[key] = typeof value === "string" ? value.trim() || null : value;
  }
  if (!Object.keys(allowed).length) return getMyProfile();
  const { data, error } = await sb
    .from("profiles")
    .update(allowed)
    .eq("id", user.id)
    .select(PROFILE_FIELDS)
    .single();
  if (error) throw error;
  return data;
}

export async function getMyRoles() {
  const { sb, user } = await authed();
  const { data, error } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  if (error) throw error;
  return (data || []).map((r) => r.role).filter(Boolean);
}

export async function hasRole(role) {
  const roles = await getMyRoles();
  return roles.includes(role);
}
