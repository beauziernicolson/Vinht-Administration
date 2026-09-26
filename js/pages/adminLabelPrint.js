import { getSession } from "../services/auth.js";
import { getMyRoles } from "../services/profile.js";
import { getLabelBatch,getLabelingOrder } from "../services/adminLabeling.js";

const esc=(v)=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));

async function boot(){
  const host=document.querySelector("#labelPrintHost"),id=new URL(location.href).searchParams.get("id");
  if(!host||!id)return;
  const session=await getSession(),roles=await getMyRoles().catch(()=>[]);
  if(!session?.user||!roles.includes("admin")){host.innerHTML='<p>Accès administrateur requis.</p>';return;}
  try{
    const [batch,ctx]=await Promise.all([getLabelBatch(id),getLabelingOrder(id)]);
    const labels=[];
    for(const line of batch||[]){for(let i=0;i<Number(line.quantity_to_print||0);i++)labels.push({...line,index:i+1});}
    document.querySelector("#printTitle").textContent=`${ctx.order.order_number} · ${ctx.order.shop_name} · ${labels.length} étiquette(s)`;
    host.innerHTML=labels.map((x,i)=>`<article class="physical-label"><div class="label-brand">VinHT</div><strong>${esc(x.product_name)}</strong><small>${esc(Object.entries(x.variant_options||{}).map(([k,v])=>`${k}: ${v}`).join(" · ")||x.sku||"")}</small><svg class="barcode" id="bc${i}" data-code="${esc(x.internal_code)}"></svg><div class="label-code">${esc(x.internal_code)}</div></article>`).join("")||'<p>Aucune étiquette à imprimer.</p>';
    host.querySelectorAll(".barcode").forEach(svg=>{if(window.JsBarcode)window.JsBarcode(svg,svg.dataset.code,{format:"CODE128",displayValue:false,height:34,margin:0,width:1.5});});
    document.querySelector("#printBtn")?.addEventListener("click",()=>window.print());
  }catch(err){host.innerHTML=`<p>${esc(err.message||"Impossible de générer les étiquettes.")}</p>`;}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
