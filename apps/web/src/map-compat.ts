/**
 * Electron 37 (Chromium anterior ao 145) não possui os métodos
 * Map/WeakMap.prototype.getOrInsertComputed usados por bibliotecas atuais.
 * Mantemos um shim OSS local, só quando a implementação nativa está ausente.
 */
type ComputedMap<K,V>=Map<K,V> & {getOrInsertComputed?:(key:K,compute:(key:K)=>V)=>V};
type ComputedWeakMap<K extends object,V>=WeakMap<K,V> & {getOrInsertComputed?:(key:K,compute:(key:K)=>V)=>V};

export function installMapCompatibility(){
 const mapPrototype=Map.prototype as ComputedMap<unknown,unknown>;
 if(typeof mapPrototype.getOrInsertComputed!=='function'){
  Object.defineProperty(Map.prototype,'getOrInsertComputed',{
   configurable:true,writable:true,
   value:function(this:Map<unknown,unknown>,key:unknown,compute:(key:unknown)=>unknown){
    if(typeof compute!=='function')throw new TypeError('Callback obrigatório');
    if(this.has(key))return this.get(key);
    const result=compute(key);
    this.set(key,result);
    return result;
   }
  });
 }
 const weakPrototype=WeakMap.prototype as ComputedWeakMap<object,unknown>;
 if(typeof weakPrototype.getOrInsertComputed!=='function'){
  Object.defineProperty(WeakMap.prototype,'getOrInsertComputed',{
   configurable:true,writable:true,
   value:function(this:WeakMap<object,unknown>,key:object,compute:(key:object)=>unknown){
    // O WeakMap só permite chaves fracas. Não chamar callback em caso de chave inválida.
    const kind=typeof key;
    if((kind!=='object'||key===null)&&kind!=='function'&&kind!=='symbol')
     throw new TypeError('Chave inválida para WeakMap');
    if(kind==='symbol'&&Symbol.keyFor(key as unknown as symbol)!==undefined)
     throw new TypeError('Símbolo registrado não é uma chave fraca');
    if(typeof compute!=='function')throw new TypeError('Callback obrigatório');
    if(this.has(key))return this.get(key);
    const result=compute(key);
    this.set(key,result);
    return result;
   }
  });
 }
}

installMapCompatibility();
