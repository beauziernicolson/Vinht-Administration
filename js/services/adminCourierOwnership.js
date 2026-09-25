import { adminRpc } from "./adminControl.js";

export async function adminSetCourierAvailability(courierProfileId, status, reason) {
  const id = String(courierProfileId || "").trim();
  const next = String(status || "").trim().toLowerCase();
  const why = String(reason || "").trim();
  if (!id) throw new Error("courier_profile_required");
  if (!["offline", "available"].includes(next)) throw new Error("unsupported_admin_availability_status");
  if (why.length < 5) throw new Error("reason_required");
  return adminRpc("admin_set_courier_availability_v1", {
    p_courier_profile_id: id,
    p_status: next,
    p_reason: why,
  });
}
