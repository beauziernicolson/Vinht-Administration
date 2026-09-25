import { getCategories, getProducts, productImageUrl } from "../services/catalog.js";
import { CATEGORY_VISUALS } from "../data/catalog-category-visuals.js?v=20260920restore";

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=(v)=>String(v??"").replace(/[&<>"']/g,(m)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const money=(n,c="HTG")=>{const cur=String(c||"HTG").toUpperCase()==="USD"?"USD":"HTG";return new Intl.NumberFormat("fr-FR",{minimumFractionDigits:cur==="USD"?2:0,maximumFractionDigits:2}).format(Number(n)||0)+" "+cur};
const params=()=>new URLSearchParams(location.search);
const isProductsPage=()=>/(^|\/)products\.html$/i.test(location.pathname);
const linkFor=(base,obj={})=>{const q=new URLSearchParams();Object.entries(obj).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=="")q.set(k,v)});const t=q.toString();return base+(t?`?${t}`:"")};
const productUrl=(p)=>`product.html?id=${encodeURIComponent(p.id)}`;
const imageFor=(p)=>{const a=Array.isArray(p?.product_images)?[...p.product_images]:[];a.sort((x,y)=>(y?.is_primary?1:0)-(x?.is_primary?1:0)||(Number(x?.position)||0)-(Number(y?.position)||0));return a[0]?.storage_path?productImageUrl(a[0].storage_path):""};
const placeholder=(name)=>`<span style="display:grid;place-items:center;min-height:190px;background:#f5f6f8;color:#7a8190;padding:18px;text-align:center"><span><i data-lucide="image"></i><br><small>${esc(name)}</small></span></span>`;

function card(p){
  const m=p?.merchants||{},img=imageFor(p),url=productUrl(p);
  const compare=Number(p.compare_at_price)>Number(p.retail_price)?Number(p.compare_at_price):null;
  const off=compare?Math.round((1-Number(p.retail_price)/compare)*100):0;
  return `<article class="v11-product-card" data-product-id="${esc(p.id)}">
    <div class="v11-product-img">${off?`<span class="v11-deal">-${off}%</span>`:""}<a class="v11-product-media-link" href="${url}">${img?`<img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`:placeholder(p.name)}</a></div>
    <div class="v11-card-body"><h3><a href="${url}">${esc(p.name)}</a></h3><div class="v11-seller">${esc(m.shop_name||"Marchand VinHT")}</div>
    <div class="v11-price">${money(p.retail_price,p.currency)}${compare?`<span class="v11-compare">${money(compare,p.currency)}</span>`:""}</div>
    <div class="v11-stock">● ${Number(p.stock)>0?"En stock":"Épuisé"}</div>
    ${p.wholesale_price!=null&&p.wholesale_min_qty?`<span class="v11-wholesale">Gros ${money(p.wholesale_price,p.currency)} · MOQ ${esc(p.wholesale_min_qty)}</span>`:""}
    <div class="v11-card-actions"><a href="${url}">Voir le produit</a></div></div>
  </article>`;
}
const topCategories=(cats)=>cats.filter(c=>!c.parent_id);
const descendants=(cats,id)=>new Set([id,...cats.filter(c=>c.parent_id===id).map(c=>c.id)]);
const LIVE_CATEGORY_MAP={
  "mode":["mode-beaute"],
  "electronique":["electronique"],
  "telephones-accessoires":["electronique"],
  "informatique":["electronique"],
  "maison-deco":["maison-bureau"],
  "electromenager":["maison-bureau"],
  "beaute-sante":["mode-beaute","sante"],
  "sante-hygiene":["sante"],
  "supermarche":["alimentation"],
  "bebe-enfants":["bebe-enfant"],
  "auto-moto":["auto-moto"]
};
function liveCategoryIds(cats,visualSlug){
  if(!visualSlug)return null;
  const mapped=LIVE_CATEGORY_MAP[visualSlug]||[visualSlug];
  return new Set(cats.filter(x=>mapped.includes(x.slug)).map(x=>x.id));
}

function categoryCards(){
  return `<div class="v11-breadcrumb"><a href="index.html">Accueil</a><span>›</span><strong>Catégories</strong></div>
    <div class="v11-categories-hero">
      <div>
        <span class="v11-cat-kicker">Catalogue VinHT</span>
        <h1>Toutes les catégories</h1>
        <p>Explorez tous les univers VinHT et découvrez les produits réellement disponibles dans chacun.</p>
      </div>
      <label class="v11-category-search"><i data-lucide="search"></i><input id="v11CategorySearch" placeholder="Rechercher une catégorie…"></label>
    </div>
    <div class="v11-all-grid">
      ${CATEGORY_VISUALS.map(c=>`
        <article class="v11-cat-card">
          <a class="v11-cat-image" href="${linkFor("category.html",{category:c.slug,view:"products"})}"><img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy" decoding="async"></a>
          <h3><a href="${linkFor("category.html",{category:c.slug,view:"products"})}">${esc(c.name)}</a></h3>
          <p>${esc(c.desc)}</p>
          <div class="v11-sub-links">${(c.subs||[]).slice(0,4).map(s=>`<a href="${linkFor("category.html",{category:c.slug,view:"products"})}">${esc(s)}</a>`).join("")}</div>
          <a class="v11-cat-open" href="${linkFor("category.html",{category:c.slug,view:"products"})}"><span>Explorer</span><span>→</span></a>
        </article>`).join("")}
    </div>
    <div class="v11-cat-reference"><strong>Catalogue large :</strong> 25 univers illustrés. Les produits affichés restent issus exclusivement du catalogue réel VinHT.</div>`;
}
function discoveryNav(){
  const active=params().get("collection")||"all";
  const items=[["all","Tous","grid-2x2"],["offers","Offres","tag"],["new","Nouveautés","sparkles"],["wholesale","En gros","package-open"]];
  return `<div class="v13-discovery">${items.map(([k,l,i])=>`<a class="${active===k?"active":""}" href="${linkFor("products.html",k==="all"?{}:{collection:k})}"><i data-lucide="${i}"></i><span>${l}</span></a>`).join("")}</div>`;
}
function listingShell(cats,current){
  const productsPage=isProductsPage(),p=params(),q=p.get("q")||"";
  const title=q?`Résultats pour « ${q} »`:current?.name||(productsPage?"Tous les produits":"Produits");
  const chips=CATEGORY_VISUALS.map(c=>`<a class="v11-sub-chip ${current?.slug===c.slug?"active":""}" href="${linkFor(productsPage?"products.html":"category.html",{category:c.slug,view:"products"})}">${esc(c.name)}</a>`).join("");
  return `<div class="v11-breadcrumb"><a href="index.html">Accueil</a><span>›</span><strong>${esc(title)}</strong></div>
    <div class="v11-listing-top"><div class="v11-listing-head"><span class="v11-cat-kicker">Catalogue live</span><div class="v11-title-line"><span class="v11-title-icon"><i data-lucide="grid-2x2"></i></span><div><h1>${esc(title)}</h1><p>${esc(current?.desc||current?.description||"Produits actuellement disponibles sur VinHT.")}</p><div class="v11-result-count"><strong id="v11Count">0</strong> produit(s) disponible(s)</div></div></div></div></div>
    ${productsPage?discoveryNav():""}<div class="v11-subcategory-strip"><a class="v11-sub-chip ${!current?"active":""}" href="${productsPage?"products.html":"category.html?view=products"}">Tout</a>${chips}</div>
    <div class="v11-shop-layout"><section class="v11-products-area" style="grid-column:1/-1"><div class="v11-toolbar"><div class="v11-toolbar-left"><span id="v11ToolbarCount">0</span> produits trouvés</div><div class="v11-toolbar-right"><input class="v11-sort" id="v11LiveSearch" type="search" value="${esc(q)}" placeholder="Rechercher…"><select class="v11-sort" id="v11Sort"><option value="default">Plus récents</option><option value="price_asc">Prix croissant</option><option value="price_desc">Prix décroissant</option><option value="newest">Nouveautés</option></select></div></div><div class="v11-product-grid" id="v11ProductGrid"><div class="loading-state">Chargement…</div></div></section></div>`;
}
async function boot(){
  const app=$("#v11CatalogApp");if(!app)return;
  try{
    const cats=await getCategories();
    const p=params(),slug=p.get("category")||"",current=CATEGORY_VISUALS.find(c=>c.slug===slug)||null;
    const productView=isProductsPage()||p.get("view")==="products"||p.has("q")||p.has("collection")||!!current;
    if(!productView){
      app.innerHTML=categoryCards();
      $("#v11CategorySearch")?.addEventListener("input",e=>{const q=String(e.target.value||"").toLowerCase();$$(".v11-cat-card").forEach(x=>x.hidden=!!q&&!x.textContent.toLowerCase().includes(q))});
      window.lucide?.createIcons?.();return;
    }
    app.innerHTML=listingShell(cats,current);
    const sort=$("#v11Sort"),search=$("#v11LiveSearch"),grid=$("#v11ProductGrid");
    const requested=p.get("sort");if(requested&&sort?.querySelector(`option[value="${CSS.escape(requested)}"]`))sort.value=requested;
    const draw=async()=>{
      grid.innerHTML='<div class="loading-state">Chargement des produits disponibles…</div>';
      const term=String(search?.value||"").trim();
      let rows=await getProducts({limit:120,search:term,sort:sort?.value||"default"});
      if(current){const ids=liveCategoryIds(cats,current.slug);rows=ids&&ids.size?rows.filter(x=>ids.has(x.category_id)):[]}
      const collection=p.get("collection")||"all";
      if(collection==="offers")rows=rows.filter(x=>Number(x.compare_at_price)>Number(x.retail_price));
      if(collection==="new")rows=rows.filter(x=>{const t=Date.parse(x.created_at||"");return Number.isFinite(t)&&(Date.now()-t)<=30*86400000});
      if(collection==="wholesale")rows=rows.filter(x=>x.wholesale_price!=null&&x.wholesale_min_qty);
      $("#v11Count").textContent=String(rows.length);$("#v11ToolbarCount").textContent=String(rows.length);
      grid.innerHTML=rows.length?rows.map(card).join(""):'<div class="v11-empty" style="grid-column:1/-1"><h3>Aucun produit disponible</h3><p>Cette catégorie reste disponible dans VinHT, mais aucun produit actif n’y est publié actuellement.</p></div>';
      window.lucide?.createIcons?.();
    };
    sort?.addEventListener("change",draw);
    search?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();draw()}});
    await draw();
  }catch(err){
    console.warn("[VinHT] catalogue live:",err);
    app.innerHTML='<div class="error-state">Impossible de charger le catalogue actuellement.</div>';
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
