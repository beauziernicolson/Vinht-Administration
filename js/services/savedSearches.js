const KEY = "vinht-saved-searches-v1";
function read(){try{return JSON.parse(localStorage.getItem(KEY)||"[]")||[]}catch{return []}}
function write(v){localStorage.setItem(KEY,JSON.stringify(v.slice(0,20)))}
function uid(){try{return crypto.randomUUID()}catch{return `s-${Date.now()}-${Math.random().toString(36).slice(2,8)}`}}
export function getSavedSearches(){return read()}
export function saveSearch({query="",categoryId="",categoryLabel="",sort="default"}={}){
  const clean=String(query||"").trim();
  if(!clean && !categoryId) throw new Error("empty-search");
  const row={id:uid(),query:clean,categoryId:categoryId||"",categoryLabel:categoryLabel||"",sort:sort||"default",createdAt:new Date().toISOString()};
  const items=read().filter(x=>!(x.query===row.query&&x.categoryId===row.categoryId&&x.sort===row.sort));
  items.unshift(row);write(items);return row;
}
export function removeSavedSearch(id){write(read().filter(x=>x.id!==id))}
export function clearSavedSearches(){localStorage.removeItem(KEY)}
export function savedSearchUrl(row){
  const p=new URLSearchParams();
  if(row?.query)p.set("q",row.query);
  if(row?.categoryId)p.set("category",row.categoryId);
  if(row?.sort&&row.sort!=="default")p.set("sort",row.sort);
  return `category.html${p.toString()?`?${p}`:""}`;
}
