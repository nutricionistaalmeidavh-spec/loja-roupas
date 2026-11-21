/** Combine cursor pages without duplicated products. Last received snapshot wins. */
export function appendCatalogPage<T extends {id:string}>(current:readonly T[],incoming:readonly T[],append=true):T[]{
 if(!append)return [...incoming];
 const indexed=new Map(current.map(item=>[item.id,item]));
 for(const item of incoming)indexed.set(item.id,item);
 return [...indexed.values()];
}
