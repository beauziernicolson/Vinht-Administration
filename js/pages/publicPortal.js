import { money } from "../lib/format.js";
import { refreshIcons } from "../lib/icons.js";
import { productImageUrl } from "../services/catalog.js";
import { getDeals,getNewArrivals,getPublicMerchants,getPublicMerchant,getPublicProductsByMerchant } from "../services/market.js";
import { isMerchantFollowed, toggleMerchantFollow, isAuthenticated, isMerchantFollowedRemote, setMerchantFollowRemote } from "../services/following.js";
import { notificationErrorMessageFr } from "../services/notifications.js";
import { addToCart } from "../services/cart.js";
import { getSession } from "../services/auth.js";
import { getMyOrders } from "../services/orders.js";
import { openAuthModal } from "../ui/authModal.js";
import { showToast } from "../ui/toast.js";

const PLACEHOLDER="assets/abstract-brand.jpg";
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const loading=(t="Chargement…")=>`<div class="loading-state">${esc(t)}</div>`;
const empty=(t,d)=>`<div class="empty-state"><div class="empty-icon"><i data-lucide="package-open"></i></div><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`;
const errorBox=t=>`<div class="error-state">${esc(t)}</div>`;

function primaryImage(p){const imgs=Array.isArray(p.product_images)?[...p.product_images]:[];imgs.sort((a,b)=>(a?.is_primary?0:1)-(b?.is_primary?0:1)||(a?.position??99)-(b?.position??99));return productImageUrl(imgs[0]?.storage_path)||PLACEHOLDER}
function card(p){const img=primaryImage(p),m=p.merchants||{};const compare=p.compare_at_price!=null&&Number(p.compare_at_price)>Number(p.retail_price)?`<span class="vh-cat-compare">${money(Number(p.compare_at_price),p.currency)}</span>`:"";const pct=compare?Math.round((1-Number(p.retail_price)/Number(p.compare_at_price))*100):0;return `<article class="product-card"><a href="product.html?id=${encodeURIComponent(p.id)}"><div class="prod-img"><img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy">${pct?`<span class="badge red" style="position:absolute;left:6px;top:6px">-${pct}%</span>`:""}</div></a><h4><a href="product.html?id=${encodeURIComponent(p.id)}">${esc(p.name)}</a></h4><div class="seller">${m.id?`<a href="store.html?merchant=${encodeURIComponent(m.id)}">${esc(m.shop_name||"Marchand VinHT")}</a>`:esc(m.shop_name||"Marchand VinHT")}</div><div class="price">${money(p.retail_price,p.currency)} ${compare}</div>${p.wholesale_price!=null&&p.wholesale_min_qty?`<div class="vh-cat-wholesale">Gros ${money(p.wholesale_price,p.currency)} · min ${esc(p.wholesale_min_qty)}</div>`:""}<button class="add" data-public-add type="button" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-seller="${esc(m.shop_name||"Marchand VinHT")}" data-price="${esc(p.retail_price)}" data-currency="${esc(p.currency||"HTG")}" data-img="${esc(img)}">Ajouter au panier</button></article>`}
function bindAdds(host){host.querySelectorAll("[data-public-add]").forEach(b=>b.addEventListener("click",()=>{try{const added=addToCart({id:b.dataset.id,productId:b.dataset.id,pricingTier:"retail",name:b.dataset.name,seller:b.dataset.seller,price:b.dataset.price,currency:b.dataset.currency||"HTG",img:b.dataset.img});showToast(added?"Ajouté au panier ✓":"Produit de démonstration : aperçu uniquement.")}catch(err){if(err?.code==="mixed_currency_cart_not_supported"){showToast("Votre panier contient déjà des articles dans une autre devise. Finalisez ou videz ce panier avant d’ajouter ce produit.","red");return}throw err}}))}

async function productList(loader,hostId,emptyTitle){const host=document.querySelector(hostId);if(!host)return;host.innerHTML=loading();try{const rows=await loader();if(!rows.length){host.innerHTML=empty(emptyTitle,"Aucun produit correspondant n’est disponible pour le moment.");refreshIcons();return}host.innerHTML=`<div class="product-grid">${rows.map(card).join("")}</div>`;bindAdds(host);refreshIcons()}catch{host.innerHTML=errorBox("Impossible de charger les produits.")}}

async function storesPage(){const host=document.querySelector("#storesHost");if(!host)return;host.innerHTML=loading("Chargement des boutiques…");try{const rows=await getPublicMerchants();if(!rows.length){host.innerHTML=empty("Aucune boutique","Les boutiques actives apparaîtront ici.");refreshIcons();return}host.innerHTML=`<div class="quick-grid">${rows.map(m=>`<a class="quick-card" href="store.html?merchant=${encodeURIComponent(m.id)}"><div class="quick-icon"><i data-lucide="store"></i></div><div><strong>${esc(m.shop_name)}</strong><small>${esc(m.merchant_type||"Marchand")} · ${esc(m.trust_score??"—")}/100 · ${esc(m.average_rating??0)}/5</small></div></a>`).join("")}</div>`;refreshIcons()}catch{host.innerHTML=errorBox("Impossible de charger les boutiques.")}}

async function storePage(){const host=document.querySelector("#storeHost");if(!host)return;const id=new URL(location.href).searchParams.get("merchant")||"";if(!id){host.innerHTML=empty("Boutique introuvable","Aucun marchand n’a été sélectionné.");refreshIcons();return}host.innerHTML=loading("Chargement de la boutique…");try{const [m,products]=await Promise.all([getPublicMerchant(id),getPublicProductsByMerchant(id)]);if(!m){host.innerHTML=empty("Boutique indisponible","Cette boutique n’est pas publique actuellement.");refreshIcons();return}// Suivi : pour un compte connecté, l'abonnement notifications réel côté
    // serveur fait foi (jamais le localStorage) ; le fallback local ne sert
    // qu'aux visiteurs anonymes et ne reçoit aucune notification serveur.
    // Leçon #27 : une panne de lecture pour un utilisateur authentifié ne
    // signifie JAMAIS "non suivi" — elle affiche un état indisponible avec
    // action Réessayer, jamais un faux `false`.
    const authed = await isAuthenticated();
    let followed = false;
    let followUnavailable = false;
    if (authed) {
      try { followed = await isMerchantFollowedRemote(id); }
      catch { followUnavailable = true; }
    } else {
      followed = isMerchantFollowed(id);
    }
    const followBtnHtml = () => followUnavailable
      ? `<button id="followStoreBtn" class="btn btn-ghost" type="button" data-follow-retry><i data-lucide="rotate-cw"></i> <span>Suivi indisponible — Réessayer</span></button>`
      : `<button id="followStoreBtn" class="btn ${followed?"btn-dark":"btn-outline-blue"}" type="button"><i data-lucide="${followed?"check":"plus"}"></i> <span>${followed?"Suivi":"Suivre"}</span></button>`;
    host.innerHTML=`<section class="portal-card" style="padding:20px"><div class="toolbar"><div><span class="portal-kicker">Boutique VinHT</span><h1 style="font-size:25px;margin:4px 0">${esc(m.shop_name)}</h1><div class="table-secondary">${esc(m.merchant_type||"Marchand")} · Confiance ${esc(m.trust_score??"—")}/100 · ${esc(m.average_rating??0)}/5 (${esc(m.rating_count??0)} avis)</div></div><div class="toolbar-group" data-follow-btn-wrap>${followBtnHtml()}</div></div>${m.description?`<p class="muted" style="font-size:11px;max-width:80ch">${esc(m.description)}</p>`:""}</section><div class="section-head" style="margin-top:22px"><div><h2>Produits de la boutique</h2><small>${products.length} produit${products.length===1?"":"s"} disponible${products.length===1?"":"s"}</small></div></div>${products.length?`<div class="product-grid">${products.map(card).join("")}</div>`:empty("Aucun produit","Cette boutique n’a pas encore de produit public.")}`
    function wireFollowBtn(){
      const wrap = host.querySelector("[data-follow-btn-wrap]");
      const btn = wrap?.querySelector("#followStoreBtn");
      if (!btn) return;
      if (btn.hasAttribute("data-follow-retry")) {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try { followed = await isMerchantFollowedRemote(id); followUnavailable = false; }
          catch { showToast(notificationErrorMessageFr(null, "Suivi toujours indisponible."), "red"); btn.disabled = false; return; }
          wrap.innerHTML = followBtnHtml();
          refreshIcons();
          wireFollowBtn();
        });
        return;
      }
      btn.addEventListener("click",async()=>{
        if (!authed) {
          const next=toggleMerchantFollow(id);
          btn.className=`btn ${next?"btn-dark":"btn-outline-blue"}`;
          btn.innerHTML=`<i data-lucide="${next?"check":"plus"}"></i> <span>${next?"Suivi":"Suivre"}</span>`;
          refreshIcons();
          showToast(next?"Boutique suivie sur cet appareil (connectez-vous pour recevoir les notifications)":"Boutique retirée des suivis");
          return;
        }
        btn.disabled=true;
        const next=!followed;
        try{
          await setMerchantFollowRemote(id, next);
          followed=next;
          btn.className=`btn ${next?"btn-dark":"btn-outline-blue"}`;
          btn.innerHTML=`<i data-lucide="${next?"check":"plus"}"></i> <span>${next?"Suivi":"Suivre"}</span>`;
          refreshIcons();
          showToast(next?"Boutique suivie ✓":"Boutique retirée des suivis");
        }catch(err){
          showToast(notificationErrorMessageFr(err?.message,"Impossible de mettre à jour le suivi."),"red");
        }finally{
          btn.disabled=false;
        }
      });
    }
    wireFollowBtn();
    bindAdds(host);refreshIcons()}catch{host.innerHTML=errorBox("Impossible de charger cette boutique.")}}

function helpPage(){const search=document.querySelector("#helpSearch"),items=[...document.querySelectorAll(".faq-item")];search?.addEventListener("input",()=>{const q=search.value.trim().toLowerCase();items.forEach(x=>x.hidden=!!q&&!x.textContent.toLowerCase().includes(q))});document.querySelectorAll("[data-faq-filter]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("[data-faq-filter]").forEach(x=>x.classList.remove("active"));b.classList.add("active");const cat=b.dataset.faqFilter;items.forEach(x=>x.hidden=cat!=="all"&&x.dataset.faqCategory!==cat)}))}

async function trackingPage(){const form=document.querySelector("#trackingForm"),host=document.querySelector("#trackingHost");if(!form||!host)return;form.addEventListener("submit",async e=>{e.preventDefault();const session=await getSession();if(!session?.user){host.innerHTML=empty("Connexion requise","Connectez-vous pour consulter vos propres commandes.");openAuthModal("login");refreshIcons();return}const q=String(form.order_id.value||"").trim().toLowerCase();host.innerHTML=loading();try{const rows=await getMyOrders();const o=rows.find(x=>String(x.id).toLowerCase()===q||String(x.id).toLowerCase().startsWith(q));if(!o){host.innerHTML=empty("Commande introuvable","Aucune de vos commandes ne correspond à cet identifiant.");refreshIcons();return}host.innerHTML=`<div class="portal-card"><div class="toolbar"><div><strong>Commande #${esc(String(o.id).slice(0,8))}</strong><div class="table-secondary">${esc(new Date(o.created_at).toLocaleString("fr-FR"))}</div></div><span class="badge blue">${esc(o.status||"—")}</span></div><div class="settings-section"><div><strong>Paiement</strong><p>${esc(o.payment_method||"—")}</p></div><span class="badge">${esc(o.payment_status||"—")}</span></div><div class="settings-section"><div><strong>Livraison</strong><p>${esc(o.delivery_type||"—")}</p></div><strong>${money(o.total_htg)}</strong></div><a class="btn btn-blue btn-sm" href="order-detail.html?id=${encodeURIComponent(o.id)}">Voir le détail</a></div>`}catch{host.innerHTML=errorBox("Impossible de charger la commande.")}})}

export async function initPublicPortal(){const page=document.body.dataset.publicPage;if(!page)return;if(page==="deals")await productList(()=>getDeals(),"#publicProductsHost","Aucune offre");else if(page==="new")await productList(()=>getNewArrivals(),"#publicProductsHost","Aucune nouveauté");else if(page==="stores")await storesPage();else if(page==="store")await storePage();else if(page==="help")helpPage();else if(page==="tracking")trackingPage();refreshIcons()}
