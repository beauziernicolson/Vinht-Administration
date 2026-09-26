import { addToCart, getCart, setCart, updateCartCount } from '../services/cart.js';
import { showToast } from '../ui/toast.js';

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money = (n) => `${Number(n || 0).toLocaleString('fr-FR')} HTG`;
const q = new URLSearchParams(location.search);
const isDemo = q.get('catalogDemo') === '1';
const data = window.VINHT_CATALOG_V11 || {categories:[],products:[]};
const product = isDemo ? (data.products || []).find(p => p.id === q.get('id')) : null;

function setText(id,v){ const e=document.getElementById(id); if(e) e.textContent = v ?? ''; }
function show(id,on=true){ const e=document.getElementById(id); if(e) e.style.display = on ? '' : 'none'; }
function initial(s=''){ return String(s).trim().charAt(0).toUpperCase() || 'V'; }

function setupTabs(){
  $$('[data-v12-tab]').forEach(btn => btn.addEventListener('click', () => {
    $$('[data-v12-tab]').forEach(x=>x.classList.toggle('active', x===btn));
    $$('[data-v12-panel]').forEach(p=>p.classList.toggle('active', p.dataset.v12Panel===btn.dataset.v12Tab));
  }));
}

function relatedCard(p){
  return `<article class="v12-related-card">
    <a class="img" href="product.html?id=${encodeURIComponent(p.id)}&catalogDemo=1"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async"></a>
    <div class="body"><h3>${esc(p.name)}</h3><div class="merchant">${esc(p.merchant)}</div><div class="price">${money(p.price)}</div><div class="rating">★ ${Number(p.rating||0).toFixed(1)}</div></div>
  </article>`;
}

function variantsFor(key,current){
  const k=key.toLowerCase();
  const pools = [
    [/couleur|color/, ['Noir','Blanc','Bleu','Rouge','Beige']],
    [/taille|size/, ['XS','S','M','L','XL']],
    [/stockage|storage/, ['64 Go','128 Go','256 Go','512 Go']],
    [/ram|mémoire/, ['4 Go','8 Go','12 Go','16 Go']],
    [/volume|capacité/, ['Petit','Moyen','Grand']],
    [/matière|material/, ['Coton','Polyester','Cuir','Bois']],
    [/dimension|longueur|largeur/, ['Compact','Moyen','Grand']],
    [/pointure/, ['38','39','40','41','42','43']],
  ];
  const pool = (pools.find(([r])=>r.test(k))||[])[1] || [];
  return [...new Set([current, ...pool].filter(Boolean))].slice(0,5);
}

function buildVariants(p){
  const wrap=$('#pdpVariants'); if(!wrap) return;
  const entries = Object.entries(p.attributes||{}).filter(([k,v]) => v && !/marque|brand|certification|prestataire|producteur/i.test(k)).slice(0,3);
  if (!entries.length) { wrap.innerHTML=''; return; }
  wrap.innerHTML = entries.map(([k,v])=>{
    const opts=variantsFor(k,v);
    return `<div class="v12-variant-group"><div class="v12-variant-head"><strong>${esc(k)}</strong><span>${esc(v)}</span></div><div class="v12-variant-options">${opts.map((x,i)=>`<button type="button" class="${i===0?'active':''}" data-v12-option>${esc(x)}</button>`).join('')}</div></div>`;
  }).join('');
  $$('[data-v12-option]',wrap).forEach(btn=>btn.addEventListener('click',()=>{
    const group=btn.closest('.v12-variant-group'); $$('[data-v12-option]',group).forEach(x=>x.classList.toggle('active',x===btn));
    const val=group.querySelector('.v12-variant-head span'); if(val) val.textContent=btn.textContent;
  }));
}

function galleryAssets(p){
  const by = {
    'telephones-accessoires':['assets/phone-large.jpg','assets/phone2.jpg','assets/phone3.jpg','assets/phone4.jpg'],
    'informatique':['assets/laptop.jpg',p.image],
    'beaute-sante':['assets/perfume.jpg',p.image],
    'supermarche':['assets/rice.jpg',p.image],
    'maison-deco':['assets/chair.jpg',p.image],
    'electronique':['assets/phone6.jpg','assets/phone5.jpg',p.image],
  };
  return [...new Set([p.image,...(by[p.category]||[])]).values()].filter(Boolean).slice(0,5);
}

function renderSpecs(p){
  const target=$('#pdpSpecTable'); if(!target) return;
  const rows=[['Catégorie',p.categoryName],['Sous-catégorie',p.subcategory],['État',p.condition],['Ville du marchand',p.city],['Livraison',p.delivery],['Disponibilité',p.stock>20?'En stock':'Stock faible'],...Object.entries(p.attributes||{})].filter(([,v])=>v!==undefined&&v!==null&&v!=='');
  target.innerHTML=rows.slice(0,18).map(([k,v])=>`<div class="v12-spec-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
}

function reviewBars(p){
  const count=Number(p.reviews||0); const rating=Number(p.rating||0);
  setText('pdpReviewScore',rating?rating.toFixed(1):'0.0');
  setText('pdpReviewCount',count);
  setText('pdpReviewStars',rating ? '★★★★★'.slice(0,Math.round(rating))+'☆☆☆☆☆'.slice(0,5-Math.round(rating)) : '☆☆☆☆☆');
  const bars=$('#pdpReviewBars'); if(!bars) return;
  const weights=rating>=4.5?[72,18,6,3,1]:rating>=4?[58,25,10,5,2]:[40,27,18,10,5];
  bars.innerHTML=[5,4,3,2,1].map((n,i)=>`<div class="v12-review-bar"><span>${n}★</span><i><b style="width:${weights[i]}%"></b></i><span>${weights[i]}%</span></div>`).join('');
}

function renderRelated(p){
  const same=(data.products||[]).filter(x=>x.id!==p.id&&x.category===p.category).slice(0,5);
  if(same.length){ show('pdpSimilarSection'); $('#pdpSimilarGrid').innerHTML=same.map(relatedCard).join(''); $('#pdpSimilarLink').href=`category.html?category=${encodeURIComponent(p.category)}`; }
  const merchant=(data.products||[]).filter(x=>x.id!==p.id&&x.merchant===p.merchant).slice(0,5);
  if(merchant.length){ show('pdpMerchantProductsSection'); $('#pdpMerchantProductsGrid').innerHTML=merchant.map(relatedCard).join(''); setText('pdpMerchantProductsSubtitle',`D’autres sélections de ${p.merchant}.`); }
}

function renderDemo(p){
  document.body.dataset.catalogDemo='1';
  $('#pdpDemoBanner')?.removeAttribute('hidden');
  document.title=`${p.name} — VinHT`;
  $('#pdpState')?.setAttribute('style','display:none'); show('pdpLayout'); show('pdpDescSection');
  const bc=$('#pdpBreadcrumb'); if(bc) bc.innerHTML=`<a href="index.html">Accueil</a><span>›</span><a href="category.html">Catégories</a><span>›</span><a href="category.html?category=${encodeURIComponent(p.category)}">${esc(p.categoryName)}</a><span>›</span><a href="category.html?category=${encodeURIComponent(p.category)}&subcategory=${encodeURIComponent(p.subcategory)}">${esc(p.subcategory)}</a><span>›</span><strong>${esc(p.name)}</strong>`;
  setText('pdpCategoryLabel',`${p.categoryName} · ${p.subcategory}`); setText('pdpConditionLabel',p.condition||'Neuf');
  setText('pdpName',p.name); setText('pdpMerchant',p.merchant); setText('pdpSellerName',p.merchant); setText('pdpSellerLogo',initial(p.merchant));
  setText('pdpRetail',money(p.price)); setText('pdpStockLabel',p.stock>20?'En stock':'Stock faible'); setText('pdpStockQty',`${p.stock} unités`); setText('pdpDelivery',p.delivery);
  setText('pdpMoqQty',p.moq?`${p.moq} unités`:'—'); setText('pdpMoq',p.moq?`MOQ ${p.moq} unités`:'');
  if(p.wholesale){ show('pdpWholesaleSide'); show('pdpMoqBox'); show('pdpTierRow'); setText('pdpWholesale',money(p.wholesale)); }
  setText('pdpRating',`★ ${Number(p.rating||0).toFixed(1)}`); setText('pdpReviewMeta',`${p.reviews||0} avis`); setText('pdpMRating',`${Number(p.rating||0).toFixed(1)}/5`); setText('pdpMRatingCount',p.reviews||0); setText('pdpTrust',p.verified?'92':'78'); setText('pdpTrustLevel',p.verified?'Vérifié':'Standard'); setText('pdpMZone',p.city); show('pdpMerchantActive',!!p.verified);
  setText('pdpTagline',`${p.subcategory} sélectionné sur VinHT, proposé par ${p.merchant}.`);
  setText('pdpDescription',`${p.name} est un produit fictif de démonstration utilisé pour valider l’expérience VinHT. Cette fiche montre la galerie, les variantes, les prix détail/gros, le stock, la livraison, les caractéristiques et le marchand avant branchement final aux données réelles.`);
  setText('pdpDeliveryCard',`${p.city} · délai indicatif ${p.delivery}.`);
  if(p.compare&&p.compare>p.price){ setText('pdpCompare',money(p.compare)); const off=Math.round((1-p.price/p.compare)*100); setText('pdpDiscount',`-${off}%`); show('pdpDiscount'); }
  const gallery=galleryAssets(p); setText('pdpPhotoCount',gallery.length); const main=$('#pdpMainImg'); if(main){main.src=gallery[0];main.alt=p.name;}
  const thumbs=$('#pdpThumbs'); if(thumbs){thumbs.innerHTML=gallery.map((x,i)=>`<button class="thumb ${i===0?'active':''}" type="button" data-src="${esc(x)}"><img src="${esc(x)}" alt="Vue ${i+1}" loading="lazy"></button>`).join(''); thumbs.onclick=e=>{const b=e.target.closest('.thumb'); if(!b)return; $$('.thumb',thumbs).forEach(x=>x.classList.toggle('active',x===b)); main.src=b.dataset.src;};}
  buildVariants(p); renderSpecs(p); reviewBars(p); renderRelated(p);

  let tier='retail'; let qty=1; const qtySpan=$('.v12-qty span'); const hint=$('#pdpTierHint');
  const retail=$('#pdpTierRetail'), wholesale=$('#pdpTierWholesale');
  function reflect(){ if(tier==='wholesale'&&p.moq) qty=Math.max(qty,p.moq); if(qtySpan)qtySpan.textContent=qty; if(hint)hint.textContent=tier==='wholesale'?'Gros':'Détail'; retail?.classList.toggle('btn-blue',tier==='retail'); retail?.classList.toggle('btn-outline-blue',tier!=='retail'); wholesale?.classList.toggle('btn-blue',tier==='wholesale'); wholesale?.classList.toggle('btn-outline-blue',tier!=='wholesale'); }
  retail?.addEventListener('click',()=>{tier='retail';reflect()}); wholesale?.addEventListener('click',()=>{tier='wholesale';reflect()});
  $$('.v12-qty button').forEach(b=>b.addEventListener('click',()=>{qty=Math.max(1,qty+(b.dataset.dir==='inc'?1:-1));reflect()})); reflect();
  const addBtn=$('#pdpAddCart'), buyBtn=$('#pdpBuyNow');
  [addBtn,buyBtn].forEach(btn=>{if(!btn)return;btn.disabled=true;btn.title='Produit de démonstration non achetable';});
  if(addBtn)addBtn.textContent='Aperçu de démonstration';
  if(buyBtn)buyBtn.textContent='Commande indisponible';
  const wish=$('#pdpWishlistBtn'); if(wish) wish.addEventListener('click',()=>{const on=wish.getAttribute('aria-pressed')==='true'; wish.setAttribute('aria-pressed',String(!on)); const lab=wish.querySelector('[data-heart-label]'); if(lab)lab.textContent=!on?'Dans vos favoris':'Ajouter aux favoris'; showToast(!on?'Ajouté aux favoris':'Retiré des favoris');});
  const store=$('#pdpStoreLink'); if(store) store.href=`store.html?demo=1&merchantName=${encodeURIComponent(p.merchant)}`;
  $('#pdpMerchantMoreLink')?.setAttribute('href',store?.href||'stores.html');
  window.lucide?.createIcons();
}

function enhanceLiveWhenReady(){
  if(isDemo) return;
  let tries=0;
  const timer=setInterval(()=>{
    tries++;
    const layout=$('#pdpLayout'); if(layout&&layout.style.display!=='none'){
      clearInterval(timer);
      const specs=$$('#pdpSpecList li').map(li=>li.textContent.split(' : ')).filter(x=>x.length>1);
      const table=$('#pdpSpecTable'); if(table&&specs.length) table.innerHTML=specs.map(([k,...v])=>`<div class="v12-spec-row"><span>${esc(k)}</span><strong>${esc(v.join(' : '))}</strong></div>`).join('');
      setText('pdpSellerLogo',initial($('#pdpSellerName')?.textContent)); setText('pdpPhotoCount',Math.max(1,$$('#pdpThumbs .thumb').length));
      const rating=($('#pdpRating')?.textContent||'').match(/[0-9.]+/); if(rating){setText('pdpReviewScore',rating[0]);setText('pdpReviewStars','★★★★★');}
      window.lucide?.createIcons();
    } else if(tries>80) clearInterval(timer);
  },100);
}

function setupShare(){ $('#pdpShareBtn')?.addEventListener('click',async()=>{try{if(navigator.share)await navigator.share({title:document.title,url:location.href});else{await navigator.clipboard.writeText(location.href);showToast('Lien copié ✓')}}catch{}}); }

setupTabs(); setupShare();
if(isDemo&&product) renderDemo(product); else enhanceLiveWhenReady();
