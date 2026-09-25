import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";
export async function updateMyPassword(password){
  const sb=getSupabase();if(!sb)throw new Error("Supabase non configuré");
  const session=await getSession();if(!session?.user)throw new Error("not-authenticated");
  const value=String(password||"");if(value.length<8)throw new Error("weak-password");
  const{data,error}=await sb.auth.updateUser({password:value});if(error)throw error;return data;
}
