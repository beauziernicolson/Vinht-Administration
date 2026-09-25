import { money } from "../lib/format.js";
import { refreshIcons } from "../lib/icons.js";
import { getSession } from "../services/auth.js";
import { getMyProfile, getMyRoles } from "../services/profile.js";
import { showToast } from "../ui/toast.js";
import {
  getLabelingDashboard,listLabelSupplyPurchases,listLabelingOrders,getLabelingOrder,
  getLabelingCatalog,updateLabelingSettings,recordLabelSupplyPurchase,createLabelingOrder,
  updateLabelingItemCounts,transitionLabelingOrder,scanLabelCode
} from "../services/adminLabeling.js";

const esc=(v)=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const num=(v)=>Number(v||0);
const fmt=(v)=>Number(v||0).toLocaleString("fr-FR",{maximumFractionDigits:2});
const date=(v)=>{const d=new Date(v);return Number.isNaN(d.getTime())?"—":d.toLocaleDateString("fr-FR")};
const STATUS_FR={requested:"Demandée",awaiting_dropoff:"En attente de dépôt",received:"Reçue",in_labeling:"Étiquetage",qa:"Contrôle qualité",ready_for_pickup:"Prête à récupérer",completed:"Terminée",cancelled:"Annulée"};
const badge=(s)=>{const c=s==="completed"?"green":s==="cancelled"?"red":s==="ready_for_pickup"?"blue":"amber";return `<span class="badge ${c}">${esc(STATUS_FR[s]||s)}</span>`};

async function requireAdmin(){
  const gate=document.querySelector("[data-admin-gate]"),content=document.querySelector("[data-admin-content]");
  const session=await getSession();
  if(!session?.user){if(gate){gate.hidden=false;gate.innerHTML='<div class="empty-state"><h3>Connexion requise</h3><p>Connectez-vous avec un compte administrateur.</p></div>';}return null;}
  const roles=await getMyRoles().catch(()=>[]);
  if(!roles.includes("admin")){if(gate){gate.hidden=false;gate.innerHTML='<div class="empty-state"><h3>Accès administrateur requis</h3><p>Votre compte ne peut pas gérer le service d’étiquetage.</p></div>';}return null;}
  if(gate)gate.hidden=true;if(content)content.hidden=false;
  const profile=await getMyProfile().catch(()=>null);const name=profile?.full_name||session.user.email||"Admin";
  document.querySelectorAll("[data-admin-name]").forEach(x=>x.textContent=name);
  document.querySelectorAll("[data-admin-email]").forEach(x=>x.textContent=session.user.email||"");
  document.querySelectorAll("[data-admin-initial]").forEach(x=>x.textContent=String(name).charAt(0).toUpperCase());
  return session;
}

function settingsCard(d){
  const s=d.settings||{},supply=d.supply||{};
  const material=num(supply.average_material_cost_htg),price=num(s.price_per_unit_htg),labor=num(s.labor_cost_per_unit_htg),over=num(s.overhead_cost_per_unit_htg);
  const profit=price-material-labor-over,margin=price>0?(profit/price*100):0;
  return `<div class="stat-grid">
    <div class="stat-card blue-stat"><div class="label">Prix / unité</div><div class="value">${fmt(price)} HTG</div><div class="delta">Défini par l’Admin</div></div>
    <div class="stat-card amber-stat"><div class="label">Coût matière moyen</div><div class="value">${fmt(material)} HTG</div><div class="delta">Achats enregistrés</div></div>
    <div class="stat-card green-stat"><div class="label">Marge brute estimée / unité</div><div class="value">${fmt(profit)} HTG</div><div class="delta">${fmt(margin)} % du prix</div></div>
    <div class="stat-card red-stat"><div class="label">Étiquettes en stock</div><div class="value">${fmt(supply.on_hand_units)}</div><div class="delta">achetées − utilisées</div></div>
  </div>
  <div class="portal-card"><div class="toolbar"><div><h3>Configuration du service</h3><p class="muted">Le CEO / DG modifie ici les paramètres commerciaux. Les anciennes demandes gardent leurs snapshots.</p></div>${s.enabled?'<span class="badge green">Service actif</span>':'<span class="badge red">Service désactivé</span>'}</div>
    <form id="labelSettingsForm" class="settings-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
      <label><span>Prix facturé / unité (HTG)</span><input class="input" name="price" type="number" min="0" step="0.01" value="${esc(s.price_per_unit_htg??0)}" required></label>
      <label><span>Coût main-d’œuvre / unité</span><input class="input" name="labor" type="number" min="0" step="0.01" value="${esc(s.labor_cost_per_unit_htg??0)}"></label>
      <label><span>Autres coûts / unité</span><input class="input" name="overhead" type="number" min="0" step="0.01" value="${esc(s.overhead_cost_per_unit_htg??0)}"></label>
      <label><span>Minimum d’unités</span><input class="input" name="minimum" type="number" min="1" step="1" value="${esc(s.minimum_units??1)}"></label>
      <label><span>Modèle standard</span><input class="input" name="template" value="${esc(s.standard_label_template||"STANDARD")}" required></label>
      <label style="display:flex;align-items:center;gap:8px;margin-top:24px"><input name="enabled" type="checkbox" ${s.enabled?"checked":""}> Service disponible</label>
      <label style="grid-column:1/-1"><span>Instructions marchand</span><textarea class="input" name="instructions" rows="2">${esc(s.customer_instructions||"")}</textarea></label>
      <label style="grid-column:1/-1"><span>Motif du changement</span><input class="input" name="reason" placeholder="Ex. nouveau coût des rouleaux / nouveau tarif"></label>
      <div><button class="btn btn-blue" type="submit">Enregistrer la configuration</button></div>
    </form>
  </div>`;
}

function supplyCard(purchases,d){
  const s=d.supply||{};
  return `<div class="portal-card"><div class="toolbar"><div><h3>Achats d’étiquettes / consommables</h3><p class="muted">Chaque achat met à jour le coût matière moyen et le stock physique enregistré.</p></div><span class="badge blue">${fmt(s.purchased_units)} achetées</span></div>
    <form id="labelPurchaseForm" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:16px">
      <input class="input" name="template" value="${esc(d.settings?.standard_label_template||"STANDARD")}" placeholder="Modèle">
      <input class="input" name="quantity" type="number" min="1" step="1" placeholder="Quantité achetée" required>
      <input class="input" name="total" type="number" min="0" step="0.01" placeholder="Coût total HTG" required>
      <input class="input" name="supplier" placeholder="Fournisseur">
      <input class="input" name="reference" placeholder="Référence / facture">
      <input class="input" name="date" type="date" value="${new Date().toISOString().slice(0,10)}">
      <button class="btn btn-blue" type="submit">Enregistrer l’achat</button>
    </form>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Modèle</th><th>Qté</th><th>Coût total</th><th>Coût / unité</th><th>Fournisseur</th></tr></thead><tbody>${(purchases||[]).map(p=>`<tr><td>${esc(date(p.purchased_at))}</td><td>${esc(p.template_code)}</td><td>${esc(p.quantity)}</td><td>${fmt(p.total_cost_htg)} HTG</td><td>${fmt(p.unit_cost_htg)} HTG</td><td>${esc(p.supplier_name||"—")}</td></tr>`).join("")||'<tr><td colspan="6">Aucun achat enregistré.</td></tr>'}</tbody></table></div>
  </div>`;
}

function ordersCard(rows){
  return `<div class="portal-card"><div class="toolbar"><div><h3>Demandes d’étiquetage</h3><p class="muted">Réception physique → étiquetage → scan QA → récupération.</p></div><select class="input" id="labelOrderFilter" style="max-width:220px"><option value="">Tous statuts</option>${Object.entries(STATUS_FR).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Dossier</th><th>Marchand</th><th>Unités</th><th>Tarif</th><th>Revenu</th><th>Profit estimé</th><th>Statut</th></tr></thead><tbody id="labelOrdersBody"></tbody></table></div>
  </div>`;
}

function createOrderCard(catalog){
  return `<div class="portal-card"><h3>Créer une demande pour un marchand</h3><p class="muted">En attendant le formulaire marchand, l’Admin peut enregistrer une demande reçue hors ligne.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
      <select class="input" id="labelMerchant"><option value="">Choisir un marchand</option>${catalog.merchants.map(m=>`<option value="${esc(m.id)}">${esc(m.shop_name)} · ${esc(m.environment)}</option>`).join("")}</select>
      <select class="input" id="labelProduct" disabled><option value="">Choisir un produit</option></select>
      <select class="input" id="labelVariant" disabled><option value="">Sans variante</option></select>
      <input class="input" id="labelQty" type="number" min="1" value="1" placeholder="Quantité">
      <button class="btn btn-outline-blue" id="labelAddLine" type="button">Ajouter la ligne</button>
    </div>
    <div id="labelDraftLines" style="margin:12px 0"></div>
    <textarea class="input" id="labelInternalNotes" rows="2" placeholder="Notes internes (optionnel)"></textarea>
    <div style="margin-top:10px"><button class="btn btn-blue" id="labelCreateOrder" type="button" disabled>Créer la demande</button></div>
  </div>`;
}

async function initDashboard(){
  const host=document.querySelector("#adminLabelingHost");if(!host)return;
  host.innerHTML='<div class="loading-state">Chargement du service d’étiquetage…</div>';
  try{
    const [d,purchases,orders,catalog]=await Promise.all([getLabelingDashboard(),listLabelSupplyPurchases(),listLabelingOrders(),getLabelingCatalog()]);
    host.innerHTML=settingsCard(d)+supplyCard(purchases,d)+createOrderCard(catalog)+ordersCard(orders)+`<div class="portal-card"><h3>Scanner une étiquette</h3><div class="toolbar-group"><input class="input" id="labelScan" placeholder="VHT-… / GTIN / ASIN"><button class="btn btn-blue" id="labelScanBtn">Rechercher</button></div><div id="labelScanResult" style="margin-top:10px"></div></div>`;

    const form=host.querySelector("#labelSettingsForm");
    form?.addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(form);try{await updateLabelingSettings({enabled:f.get("enabled")==="on",pricePerUnit:f.get("price"),laborCost:f.get("labor"),overheadCost:f.get("overhead"),minimumUnits:f.get("minimum"),template:f.get("template"),instructions:f.get("instructions"),reason:f.get("reason")});showToast("Configuration enregistrée ✓");initDashboard();}catch(err){showToast(err.message||"Configuration impossible","red");}});
    const pf=host.querySelector("#labelPurchaseForm");
    pf?.addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(pf);try{await recordLabelSupplyPurchase({template:f.get("template"),quantity:f.get("quantity"),totalCost:f.get("total"),supplier:f.get("supplier"),reference:f.get("reference"),purchasedAt:f.get("date")});showToast("Achat enregistré ✓");initDashboard();}catch(err){showToast(err.message||"Achat impossible","red");}});

    let draft=[];const merchant=host.querySelector("#labelMerchant"),product=host.querySelector("#labelProduct"),variant=host.querySelector("#labelVariant"),qty=host.querySelector("#labelQty"),draftHost=host.querySelector("#labelDraftLines"),createBtn=host.querySelector("#labelCreateOrder");
    const redrawDraft=()=>{draftHost.innerHTML=draft.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Article</th><th>Variante</th><th>Qté</th><th></th></tr></thead><tbody>${draft.map((x,i)=>`<tr><td>${esc(x.productName)}</td><td>${esc(x.variantLabel||"Sans variante")}</td><td>${x.quantity}</td><td><button class="btn btn-sm" data-rm="${i}">Retirer</button></td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">Aucune ligne ajoutée.</p>';createBtn.disabled=!draft.length;draftHost.querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>{draft.splice(Number(b.dataset.rm),1);redrawDraft();});};redrawDraft();
    merchant.onchange=()=>{draft=[];redrawDraft();const ps=catalog.products.filter(p=>p.merchant_id===merchant.value);product.innerHTML='<option value="">Choisir un produit</option>'+ps.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.sku?` · ${esc(p.sku)}`:""}</option>`).join("");product.disabled=!merchant.value;variant.innerHTML='<option value="">Sans variante</option>';variant.disabled=true;};
    product.onchange=()=>{const vs=catalog.variants.filter(v=>v.product_id===product.value);variant.innerHTML=vs.length?'<option value="">Choisir la variante</option>'+vs.map(v=>`<option value="${esc(v.id)}">${esc(Object.entries(v.option_values||{}).map(([k,val])=>`${k}: ${val}`).join(" · ")||v.sku)}</option>`).join(""):'<option value="">Sans variante</option>';variant.disabled=!vs.length;variant.dataset.required=vs.length?"1":"0";};
    host.querySelector("#labelAddLine").onclick=()=>{const p=catalog.products.find(x=>x.id===product.value);const q=Number(qty.value||0);const requiresVariant=variant.dataset.required==="1";const v=catalog.variants.find(x=>x.id===variant.value);if(!merchant.value||!p||q<=0||requiresVariant&&!v){showToast("Choisis le marchand, le produit, la variante si nécessaire et une quantité valide.","red");return;}draft.push({product_id:p.id,variant_id:v?.id||null,quantity:q,productName:p.name,variantLabel:v?Object.entries(v.option_values||{}).map(([k,val])=>`${k}: ${val}`).join(" · "):null});redrawDraft();};
    createBtn.onclick=async()=>{try{const created=await createLabelingOrder({merchantId:merchant.value,items:draft.map(({product_id,variant_id,quantity})=>({product_id,variant_id,quantity})),internalNotes:host.querySelector("#labelInternalNotes").value||null});showToast("Demande créée ✓");location.href=`labeling-order.html?id=${encodeURIComponent(created.id)}`;}catch(err){showToast(err.message||"Création impossible","red");}};

    const body=host.querySelector("#labelOrdersBody"),filter=host.querySelector("#labelOrderFilter");
    const drawOrders=()=>{const list=orders.filter(o=>!filter.value||o.status===filter.value);body.innerHTML=list.map(o=>`<tr><td><a href="labeling-order.html?id=${encodeURIComponent(o.id)}"><strong>${esc(o.order_number)}</strong></a></td><td>${esc(o.shop_name)}</td><td>${o.labeled_units}/${o.requested_units}</td><td>${fmt(o.price_per_unit_htg_snapshot)} HTG</td><td>${fmt(o.actual_revenue_htg)} HTG</td><td>${fmt(o.estimated_gross_profit_htg)} HTG</td><td>${badge(o.status)}</td></tr>`).join("")||'<tr><td colspan="7">Aucune demande.</td></tr>';};filter.onchange=drawOrders;drawOrders();

    host.querySelector("#labelScanBtn").onclick=async()=>{const code=host.querySelector("#labelScan").value.trim(),out=host.querySelector("#labelScanResult");if(!code)return;try{const r=await scanLabelCode(code);out.innerHTML=r?.found?`<div class="settings-section"><div><strong>${esc(r.item.product_name)}</strong><p>${esc(r.item.sku||"")} · ${esc(Object.entries(r.item.variant_options||{}).map(([k,v])=>`${k}: ${v}`).join(" · ")||"Produit sans variante")}</p></div><span class="badge green">${esc(r.item.internal_code)}</span></div>`:'<div class="error-state">Aucun article trouvé pour ce code.</div>';refreshIcons();}catch(err){out.innerHTML=`<div class="error-state">${esc(err.message||"Scan impossible")}</div>`;}};
    refreshIcons();
  }catch(err){host.innerHTML=`<div class="error-state">${esc(err.message||"Impossible de charger le module d’étiquetage.")}</div>`;}
}

const NEXT={requested:["awaiting_dropoff","received","cancelled"],awaiting_dropoff:["received","cancelled"],received:["in_labeling","cancelled"],in_labeling:["qa","cancelled"],qa:["ready_for_pickup","in_labeling","cancelled"],ready_for_pickup:["completed","cancelled"],completed:[],cancelled:[]};

async function initOrderDetail(){
  const host=document.querySelector("#adminLabelingOrderHost");if(!host)return;const id=new URL(location.href).searchParams.get("id");if(!id){host.innerHTML='<div class="error-state">Dossier absent.</div>';return;}
  host.innerHTML='<div class="loading-state">Chargement du dossier…</div>';
  try{const ctx=await getLabelingOrder(id),o=ctx.order,items=ctx.items||[],events=ctx.events||[];
    host.innerHTML=`<div class="portal-card"><div class="toolbar"><div><h3>${esc(o.order_number)}</h3><p>${esc(o.shop_name)} · ${esc(o.environment)}</p></div>${badge(o.status)}</div>
      <div class="stat-grid"><div class="stat-card blue-stat"><div class="label">Demandées</div><div class="value">${o.requested_units}</div></div><div class="stat-card amber-stat"><div class="label">Reçues</div><div class="value">${o.received_units}</div></div><div class="stat-card green-stat"><div class="label">Étiquetées / QA</div><div class="value">${o.labeled_units} / ${o.qa_passed_units}</div></div><div class="stat-card red-stat"><div class="label">Profit estimé</div><div class="value">${fmt(o.estimated_gross_profit_htg)} HTG</div></div></div>
      <div class="settings-section"><div><strong>Tarification figée pour ce dossier</strong><p>${fmt(o.price_per_unit_htg_snapshot)} HTG/unité · matière ${fmt(o.material_cost_per_unit_htg_snapshot)} · main-d’œuvre ${fmt(o.labor_cost_per_unit_htg_snapshot)} · autres ${fmt(o.overhead_cost_per_unit_htg_snapshot)}</p></div><span class="badge blue">Devis ${fmt(o.quoted_total_htg)} HTG</span></div>
      <div class="toolbar-group" style="margin-top:12px"><a class="btn btn-outline-blue" href="label-print.html?id=${encodeURIComponent(o.id)}" target="_blank">Imprimer les étiquettes</a>${(NEXT[o.status]||[]).map(s=>`<button class="btn ${s==="cancelled"?"btn-outline-red":"btn-blue"}" data-status="${s}">${esc(STATUS_FR[s])}</button>`).join("")}</div></div>
      <div class="portal-card"><h3>Articles et contrôle physique</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Article</th><th>Code VinHT</th><th>Demandé</th><th>Reçu</th><th>Étiqueté</th><th>QA OK</th><th></th></tr></thead><tbody>${items.map(i=>`<tr><td><strong>${esc(i.product_name_snapshot)}</strong><div class="table-secondary">${esc(i.sku_snapshot||"")} ${esc(Object.entries(i.variant_options_snapshot||{}).map(([k,v])=>`${k}: ${v}`).join(" · "))}</div></td><td><code>${esc(i.internal_code_snapshot)}</code></td><td>${i.requested_qty}</td><td><input class="input" style="width:82px" type="number" min="0" max="${i.requested_qty}" value="${i.received_qty}" data-rec="${i.id}"></td><td><input class="input" style="width:82px" type="number" min="0" max="${i.requested_qty}" value="${i.labeled_qty}" data-lab="${i.id}"></td><td><input class="input" style="width:82px" type="number" min="0" max="${i.requested_qty}" value="${i.qa_passed_qty}" data-qa="${i.id}"></td><td><button class="btn btn-sm btn-outline-blue" data-save="${i.id}">Sauver</button></td></tr>`).join("")}</tbody></table></div></div>
      <div class="portal-card"><h3>Historique</h3>${events.slice().reverse().map(e=>`<div class="settings-section"><div><strong>${esc(e.event_type)}</strong><p>${esc(e.from_status||"—")} → ${esc(e.to_status||"—")} · ${esc(date(e.created_at))}</p></div></div>`).join("")||'<p class="muted">Aucun événement.</p>'}</div>`;
    host.querySelectorAll("[data-save]").forEach(b=>b.onclick=async()=>{const iid=b.dataset.save;const rec=host.querySelector(`[data-rec="${iid}"]`).value,lab=host.querySelector(`[data-lab="${iid}"]`).value,qa=host.querySelector(`[data-qa="${iid}"]`).value;try{await updateLabelingItemCounts(iid,{received:rec,labeled:lab,qaPassed:qa});showToast("Quantités enregistrées ✓");initOrderDetail();}catch(err){showToast(err.message||"Mise à jour impossible","red");}});
    host.querySelectorAll("[data-status]").forEach(b=>b.onclick=async()=>{const s=b.dataset.status;let note=null;if(s==="cancelled")note=window.prompt("Motif de l’annulation :")||null;try{await transitionLabelingOrder(o.id,s,note);showToast("Statut mis à jour ✓");initOrderDetail();}catch(err){showToast(err.message||"Transition impossible","red");}});refreshIcons();
  }catch(err){host.innerHTML=`<div class="error-state">${esc(err.message||"Impossible de charger ce dossier.")}</div>`;}
}

export async function initAdminLabeling(){
  const page=document.body.dataset.adminPage;if(page!=="labeling"&&page!=="labeling-order")return;
  const ok=await requireAdmin();if(!ok)return;
  if(page==="labeling")await initDashboard();else await initOrderDetail();
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>initAdminLabeling());else initAdminLabeling();
