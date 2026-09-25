import { getLabelingCatalog,upsertProductIdentifier } from "../services/adminLabeling.js";
import { showToast } from "../ui/toast.js";

const esc=(v)=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));

async function boot(){
  const host=document.querySelector("#adminIdentifiersHost");if(!host)return;
  try{
    const c=await getLabelingCatalog();
    host.innerHTML=`<div class="portal-card"><div class="toolbar"><div><h3>Identifiants produit / variante</h3><p class="muted">VinHT génère son propre Code 128 interne. Un GTIN/UPC/EAN ou un ASIN externe peut être enregistré s’il existe réellement.</p></div><span class="badge blue">Code VinHT interne</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
        <select class="input" id="idProduct"><option value="">Choisir un produit</option>${c.products.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.environment)}</option>`).join("")}</select>
        <select class="input" id="idVariant" disabled><option value="">Produit sans variante</option></select>
        <input class="input" id="idGtin" placeholder="GTIN / UPC / EAN (optionnel)">
        <input class="input" id="idAsin" placeholder="ASIN Amazon (optionnel)">
        <button class="btn btn-blue" id="idSave" type="button">Créer / enregistrer</button>
      </div><div id="idResult" style="margin-top:10px"></div></div>`;
    const product=host.querySelector("#idProduct"),variant=host.querySelector("#idVariant"),out=host.querySelector("#idResult");
    product.onchange=()=>{const vs=c.variants.filter(v=>v.product_id===product.value);variant.innerHTML=vs.length?'<option value="">Choisir une variante</option>'+vs.map(v=>`<option value="${esc(v.id)}">${esc(Object.entries(v.option_values||{}).map(([k,val])=>`${k}: ${val}`).join(" · ")||v.sku)}</option>`).join(""):'<option value="">Produit sans variante</option>';variant.disabled=!vs.length;variant.dataset.required=vs.length?"1":"0";out.innerHTML="";};
    host.querySelector("#idSave").onclick=async()=>{if(!product.value){showToast("Choisis un produit.","red");return;}if(variant.dataset.required==="1"&&!variant.value){showToast("Ce produit a des variantes : choisis la variante exacte.","red");return;}try{const r=await upsertProductIdentifier(product.value,{variantId:variant.value||null,gtin:host.querySelector("#idGtin").value,asin:host.querySelector("#idAsin").value});out.innerHTML=`<div class="settings-section"><div><strong>Identifiant enregistré</strong><p>GTIN : ${esc(r.gtin||"—")} · ASIN : ${esc(r.asin||"—")}</p></div><code>${esc(r.internal_code)}</code></div>`;showToast("Identifiant enregistré ✓");}catch(err){showToast(err.message||"Identifiant invalide","red");}};
  }catch(err){host.innerHTML=`<div class="error-state">${esc(err.message||"Impossible de charger les identifiants.")}</div>`;}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
