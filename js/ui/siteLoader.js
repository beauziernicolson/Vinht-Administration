(function(){
  "use strict";
  const loader=document.getElementById("vinhtSiteLoader");
  if(!loader)return;
  const hide=()=>{
    if(loader.classList.contains("is-hidden"))return;
    loader.classList.add("is-hidden");
    setTimeout(()=>loader.remove(),420);
  };
  if(document.readyState==="complete") requestAnimationFrame(()=>requestAnimationFrame(hide));
  else window.addEventListener("load",hide,{once:true});
  document.addEventListener("DOMContentLoaded",()=>setTimeout(hide,180),{once:true});
  setTimeout(hide,3500);
  document.addEventListener("click",(e)=>{
    const a=e.target.closest("a[href]");
    if(!a||e.defaultPrevented||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    const href=a.getAttribute("href")||"";
    if(!href||href.startsWith("#")||href.startsWith("javascript:")||a.target==="_blank"||a.hasAttribute("download"))return;
    try{
      const u=new URL(a.href,location.href);
      if(u.origin!==location.origin)return;
      loader.classList.remove("is-hidden");
      loader.classList.add("is-navigating");
    }catch(_){ }
  });
})();