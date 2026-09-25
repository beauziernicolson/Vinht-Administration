import { getMarketplaceLaunchOffer } from "../services/launchOffer.js";

const esc=(v)=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const frDate=(v)=>{
  if(!v)return "—";
  const d=new Date(String(v)+"T12:00:00");
  return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"});
};
function seenKey(offer,merchantKey){
  return "vinht:launch-offer:v1:"+(merchantKey||"merchant")+":"+(offer?.start_date||"") + ":"+(offer?.end_date||"");
}
function wasSeen(key){try{return localStorage.getItem(key)==="1"}catch{return false}}
function markSeen(key){try{localStorage.setItem(key,"1")}catch{}}
const openKeys=new Set();

export async function maybeShowMerchantLaunchOffer({merchantKey=null,force=false}={}){
  let offer;
  try{offer=await getMarketplaceLaunchOffer()}catch{return false}
  if(!offer?.enabled||offer?.phase==="standard")return false;

  const key=seenKey(offer,merchantKey);
  if(openKeys.has(key))return false;
  if(!force&&wasSeen(key))return false;
  openKeys.add(key);

  const ind=offer.individual||{},pro=offer.professional||{};
  const pre=offer.phase==="prelaunch";
  const lastFree=offer.last_free_day||"—";
  const effectiveHtg=Number(ind.effective_per_item_fee_htg??0);
  const effectiveUsd=Number(ind.effective_per_item_fee_usd??0);
  const effectivePro=Number(pro.effective_monthly_fee_htg??0);

  const overlay=document.createElement("div");
  overlay.setAttribute("role","dialog");
  overlay.setAttribute("aria-modal","true");
  overlay.setAttribute("aria-label","Offre de lancement VinHT");
  overlay.style.cssText="position:fixed;inset:0;z-index:99999;background:rgba(10,18,35,.62);display:grid;place-items:center;padding:18px";
  overlay.innerHTML=`
    <div style="width:min(560px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:20px;box-shadow:0 24px 70px rgba(0,0,0,.28);padding:24px;color:#172033">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px">
        <div>
          <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#0b57d0">Avantage de lancement</div>
          <h2 style="margin:6px 0 6px;font-size:24px">🎉 Offre de lancement VinHT</h2>
          <p style="margin:0;color:#697386;font-size:14px;line-height:1.55">Vos frais fixes sont offerts pendant la période de lancement. La commission VinHT de <strong>${esc(offer.commission_rate)} %</strong> reste applicable.</p>
        </div>
        <button type="button" data-launch-close aria-label="Fermer" style="border:0;background:#f2f4f8;border-radius:999px;width:36px;height:36px;font-size:20px;cursor:pointer">×</button>
      </div>

      ${pre?`<div style="margin-top:18px;padding:12px 14px;border-radius:12px;background:#eef7ff;border:1px solid #cfe5ff;font-size:13px;line-height:1.5"><strong>Pré-lancement gratuit :</strong> vous profitez déjà de l’avantage maintenant, mais les 3 mois officiels commencent seulement le <strong>${esc(frDate(offer.start_date))}</strong>. Les jours avant cette date ne sont pas déduits des 3 mois.</div>`:""}

      <div style="margin-top:18px;padding:16px;border:1px solid #e5e9f0;border-radius:14px">
        <strong>Période officielle : ${esc(frDate(offer.start_date))} → ${esc(frDate(lastFree))}</strong>
        <div style="display:grid;gap:10px;margin-top:12px;font-size:14px">
          <div style="display:flex;justify-content:space-between;gap:16px"><span>Individuel — HTG</span><strong>${esc(effectiveHtg)} HTG / article</strong></div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>Individuel — USD</span><strong>${esc(effectiveUsd)} USD / article</strong></div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>Professionnel</span><strong>${esc(effectivePro)} HTG / mois</strong></div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>Commission VinHT</span><strong>${esc(offer.commission_rate)} %</strong></div>
        </div>
      </div>

      <div style="margin-top:14px;padding:16px;border-radius:14px;background:#f7f8fa;font-size:13px;line-height:1.55">
        <strong>À partir du ${esc(frDate(offer.end_date))}</strong><br>
        Si vous ne choisissez pas le plan Professionnel, votre boutique reste sur le plan Individuel :
        <strong>${esc(ind.normal_per_item_fee_htg)} HTG par article vendu + ${esc(offer.commission_rate)} %</strong>.<br>
        Le plan Professionnel reviendra à <strong>${esc(pro.normal_monthly_fee_htg)} HTG / mois + ${esc(pro.commission_rate??offer.commission_rate)} %</strong>.
      </div>

      <button type="button" class="btn btn-blue" data-launch-accept style="width:100%;margin-top:18px">J’ai compris, merci VinHT</button>
    </div>`;

  const close=()=>{markSeen(key);openKeys.delete(key);overlay.remove()};
  overlay.querySelector("[data-launch-close]")?.addEventListener("click",close);
  overlay.querySelector("[data-launch-accept]")?.addEventListener("click",close);
  overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
  try{
    document.body.appendChild(overlay);
    overlay.querySelector("[data-launch-accept]")?.focus();
    return true;
  }catch{
    openKeys.delete(key);
    return false;
  }
}
