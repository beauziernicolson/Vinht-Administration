// Toast léger, sans dépendance et sans modification de styles.css.
// Aligné sur les accents du design system Commerce V2.

export function showToast(message, tone = "blue") {
  const bg = tone === "red" ? "#e21d3c" : tone === "green" ? "#15803d" : tone === "amber" ? "#b45309" : "#0a35a8";
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.setAttribute("role", "status");
  toast.style.cssText =
    "position:fixed;right:20px;bottom:20px;background:" +
    bg +
    ";color:#fff;padding:13px 18px;border-radius:6px;font-weight:800;" +
    "z-index:9999;box-shadow:0 10px 30px #0002;font-family:inherit;max-width:calc(100vw - 40px)";
  document.body.appendChild(toast);
  // Les messages longs (motifs de blocage backend) restent lisibles.
  setTimeout(() => toast.remove(), Math.max(1600, Math.min(8000, String(message || "").length * 60)));
}
