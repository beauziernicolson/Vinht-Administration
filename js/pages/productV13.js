import { showToast } from "../ui/toast.js";
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=(v)=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
function setText(id,v){const e=document.getElementById(id);if(e)e.textContent=v??""}
function initial(s=""){return String(s).trim().charAt(0).toUpperCase()||"V"}
function setupTabs(){$$("[data-v12-tab]").forEach(btn=>btn.addEventListener("click",()=>{$$("[data-v12-tab]").forEach(x=>x.classList.toggle("active",x===btn));$$("[data-v12-panel]").forEach(p=>p.classList.toggle("active",p.dataset.v12Panel===btn.dataset.v12Tab))}))}
function enhanceLiveWhenReady(){
  let tries=0;
  const timer=setInterval(()=>{
    tries++;
    const layout=$("#pdpLayout");
    if(layout&&layout.style.display!=="none"){
      clearInterval(timer);
      const specs=$$("#pdpSpecList li").map(li=>li.textContent.split(" : ")).filter(x=>x.length>1);
      const table=$("#pdpSpecTable");
      if(table&&specs.length)table.innerHTML=specs.map(([k,...v])=>`<div class="v12-spec-row"><span>${esc(k)}</span><strong>${esc(v.join(" : "))}</strong></div>`).join("");
      setText("pdpSellerLogo",initial($("#pdpSellerName")?.textContent));
      setText("pdpPhotoCount",Math.max(1,$$("#pdpThumbs .thumb").length));
      const rating=($("#pdpRating")?.textContent||"").match(/[0-9.]+/);
      if(rating){setText("pdpReviewScore",rating[0]);setText("pdpReviewStars","★★★★★")}
      window.lucide?.createIcons?.();
    } else if(tries>80) clearInterval(timer);
  },100);
}
function setupShare(){
  $("#pdpShareBtn")?.addEventListener("click",async()=>{
    try{
      if(navigator.share)await navigator.share({title:document.title,url:location.href});
      else{await navigator.clipboard.writeText(location.href);showToast("Lien copié ✓")}
    }catch{}
  });
}
setupTabs();setupShare();enhanceLiveWhenReady();
