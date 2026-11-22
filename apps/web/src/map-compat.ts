/**
 * Chromium do Electron 37 ainda não inclui Map.prototype.getOrInsertComputed,
 * usado pelo react-data-grid. Sem o método a aba Estoque falha durante render.
 * Implementação local de compatibilidade, sem dependência externa.
 */
type EnhancedMap<K,V> = Map<K,V> & {
 getOrInsertComputed?: (key:K, compute:(key:K)=>V)=>V;
};

export function installMapCompatibility(){
 const prototype=Map.prototype as EnhancedMap<unknown,unknown>;
 if(typeof prototype.getOrInsertComputed==='function')return;
 Object.defineProperty(Map.prototype,'getOrInsertComputed',{
  configurable:true,
  writable:true,
  value:function(this:Map<unknown,unknown>,key:unknown,compute:(key:unknown)=>unknown){
   if(typeof compute!=='function')throw new TypeError('Callback obrigatório');
   if(this.has(key))return this.get(key);
   const result=compute(key);
   this.set(key,result);
   return result;
  }
 });
}

installMapCompatibility();
