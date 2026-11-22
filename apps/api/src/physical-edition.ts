export type LojaEdition='full'|'physical';
export function editionFromEnv(env:Record<string,string|undefined>=process.env):LojaEdition{
 return env.LOJA_EDITION==='physical'?'physical':'full';
}
/** Hide online services at the server boundary, not merely through navigation CSS. */
export function blockedInPhysicalEdition(pathname:string):boolean{
 const p=pathname.split('?')[0];
 return /^\/vitrine(?:\/|$)/.test(p)
 || /^\/v1\/(?:storefront|pickup-orders)(?:\/|$)/.test(p)
 || /^\/v1\/management\/(?:marketplace|storefront|pickup-orders)(?:\/|$)/.test(p);
}
