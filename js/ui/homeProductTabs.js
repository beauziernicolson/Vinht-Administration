import { getFeaturedProducts, getProducts, productImageUrl } from "../services/catalog.js";

const esc=(v)=>String(v??"").replace(/[&<>"']/g,(m)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const money=(value,currency="HTG")=>{
  const c=String(currency||"HTG").toUpperCase()==="USD"?"USD":"HTG";
  return new Intl.NumberFormat("fr-FR",{minimumFractionDigits:c==="USD"?2:0,maximumFractionDigits:2}).format(Number(value)||0)+" "+c;
};
const imageFor=(p)=>{
  const imgs=Array.isArray(p?.product_images)?[...p.product_images]:[];
  imgs.sort((a,b)=>(b?.is_primary?1:0)-(a?.is_primary?1:0)||(Number(a?.position)||0)-(Number(b?.position)||0));
  return imgs[0]?.storage_path?productImageUrl(imgs[0].storage_path):"";
};
const placeholder=(label="Produit")=>`<span style="display:grid;place-items:center;width:100%;height:100%;min-height:170px;background:#f5f6f8;color:#7a8190;font-size:12px;font-weight:700;text-align:center;padding:16px"><span><i data-lucide="image"></i><br>${esc(label)}</span></span>`;
const isNew=(p)=>{const t=Date.parse(p?.created_at||"");return Number.isFinite(t)&&(Date.now()-t)<=30*86400000};
const groups=(p)=>["all",Number(p?.compare_at_price)>Number(p?.retail_price)?"offer":"",isNew(p)?"new":""].filter(Boolean).join(" ");

function productCard(p){
  const m=p?.merchants||{},img=imageFor(p),href=`product.html?id=${encodeURIComponent(p.id)}`;
  const compare=Number(p?.compare_at_price)>Number(p?.retail_price)?Number(p.compare_at_price):null;
  const off=compare?Math.max(1,Math.round((1-Number(p.retail_price)/compare)*100)):0;
  return `<article class="v7-product-card" data-groups="${groups(p)}">
    <div class="v7-product-media">
      ${off?`<span class="v7-product-badge red">-${off}%</span>`:isNew(p)?'<span class="v7-product-badge blue">Nouveau</span>':""}
      <a href="${href}" aria-label="Voir ${esc(p.name)}">${img?`<img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`:placeholder(p.name)}</a>
    </div>
    <div class="v7-product-body">
      <a class="v7-product-name" href="${href}">${esc(p.name)}</a>
      <a class="v7-product-store" href="${p.merchant_id?`store.html?merchant=${encodeURIComponent(p.merchant_id)}`:"stores.html"}"><i data-lucide="store"></i><span>${esc(m.shop_name||"Marchand VinHT")}</span></a>
      <div class="v7-price-row"><strong>${money(p.retail_price,p.currency)}</strong>${compare?`<span class="v7-old-price">${money(compare,p.currency)}</span>`:""}</div>
      <div class="v7-meta-row">${Number(m.average_rating)>0?`<span class="v7-rating"><b>★</b> ${Number(m.average_rating).toFixed(1)} <small>(${Number(m.rating_count)||0})</small></span>`:""}${p.wholesale_price!=null&&p.wholesale_min_qty?`<span class="v7-wholesale"><i data-lucide="package-check"></i>Gros disponible</span>`:""}</div>
    </div>
  </article>`;
}

function storeCard({merchantId,merchant,products}){
  const name=merchant?.shop_name||"Boutique VinHT";
  const previews=products.slice(0,3).map(p=>{const img=imageFor(p),href=`product.html?id=${encodeURIComponent(p.id)}`;return `<a href="${href}">${img?`<img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`:placeholder(p.name)}</a>`}).join("");
  const initials=name.split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase();
  return `<article class="v8-store-card">
    <div class="v8-store-top"><div class="v8-store-logo" aria-hidden="true">${esc(initials||"V")}</div><div class="v8-store-identity"><a href="store.html?merchant=${encodeURIComponent(merchantId)}" class="v8-store-name">${esc(name)}</a><span>${esc(merchant?.merchant_type||"Marchand VinHT")}</span></div></div>
    <div class="v8-store-meta">${Number(merchant?.average_rating)>0?`<span><b>★ ${Number(merchant.average_rating).toFixed(1)}</b> (${Number(merchant.rating_count)||0} avis)</span>`:""}<span><i data-lucide="shield-check"></i>Confiance ${esc(merchant?.trust_score??"—")}/100</span></div>
    <div class="v8-store-products" aria-label="Aperçu des produits de ${esc(name)}">${previews||'<span class="muted">Aucune photo produit disponible.</span>'}</div>
    <a class="v8-store-visit" href="store.html?merchant=${encodeURIComponent(merchantId)}">Visiter la boutique <i data-lucide="arrow-right"></i></a>
  </article>`;
}

function bindTabs(){
  const tabs=[...document.querySelectorAll("[data-product-filter]")];
  tabs.forEach(tab=>tab.addEventListener("click",()=>{
    const filter=tab.dataset.productFilter||"all";
    tabs.forEach(t=>{const on=t===tab;t.classList.toggle("active",on);t.setAttribute("aria-selected",String(on))});
    document.querySelectorAll("[data-home-product-grid] .v7-product-card").forEach(card=>{
      const gs=(card.dataset.groups||"all").split(/\s+/);
      card.hidden=filter!=="all"&&!gs.includes(filter);
    });
  }));
}

async function init(){
  const grid=document.querySelector("[data-home-product-grid]");
  const stores=document.querySelector("[data-live-store-grid]");
  if(!grid&&!stores)return;
  try{
    const [featured,all]=await Promise.all([getFeaturedProducts({limit:12}).catch(()=>[]),getProducts({limit:24})]);
    const seen=new Set(),products=[];
    for(const p of [...featured,...all]) if(p?.id&&!seen.has(p.id)){seen.add(p.id);products.push(p)}
    if(grid) grid.innerHTML=products.length?products.slice(0,15).map(productCard).join(""):'<div class="empty-state"><p>Aucun produit disponible pour le moment.</p></div>';
    if(stores){
      const map=new Map();
      for(const p of products){
        if(!p?.merchant_id)continue;
        if(!map.has(p.merchant_id))map.set(p.merchant_id,{merchantId:p.merchant_id,merchant:p.merchants||{},products:[]});
        map.get(p.merchant_id).products.push(p);
      }
      const rows=[...map.values()].slice(0,5);
      stores.innerHTML=rows.length?rows.map(storeCard).join(""):'<div class="empty-state"><p>Les boutiques apparaîtront ici dès qu’elles auront des produits actifs.</p></div>';
      const section=stores.closest(".v8-stores");if(section)section.hidden=!rows.length;
    }
    bindTabs();
    window.lucide?.createIcons?.();
  }catch(err){
    console.warn("[VinHT] accueil catalogue live:",err);
    if(grid)grid.innerHTML='<div class="error-state">Impossible de charger les produits actuellement.</div>';
    if(stores)stores.innerHTML='<div class="error-state">Impossible de charger les boutiques actuellement.</div>';
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
