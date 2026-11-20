/** Representações controladas; cores desconhecidas não recebem uma tonalidade inventada. */
const colors:Record<string,string>={
 azul:'#2563eb', 'azul marinho':'#1e3a8a', 'azul claro':'#93c5fd',
 preto:'#171717', branco:'#ffffff', cinza:'#64748b', grafite:'#374151',
 areia:'#d9c6a5', bege:'#d6c6a6', nude:'#dfbca5', caramelo:'#b77943',
 marrom:'#783f28', chocolate:'#55301e', vermelho:'#dc2626', vinho:'#881337',
 bordô:'#881337', rosa:'#ec4899', 'rosa claro':'#f9a8d4', pink:'#db2777',
 amarelo:'#eab308', laranja:'#f97316', verde:'#16a34a', 'verde musgo':'#4d5d37',
 'verde militar':'#4b5320', 'verde água':'#5eead4', roxo:'#7c3aed',
 lilás:'#c4b5fd', dourado:'#d4af37', prata:'#a8a9ad', offwhite:'#faf9f6',
 'off white':'#faf9f6', creme:'#fffdd0'
};
export function colorSwatch(input:string):{background:string;known:boolean;label:string}{
 const name=input.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 const match=Object.entries(colors).find(([key])=>key.normalize('NFD').replace(/[\u0300-\u036f]/g,'')===name);
 if(match)return {background:match[1],known:true,label:''};
 if(/^#[0-9a-f]{6}$/i.test(input.trim()))return {background:input.trim().toLowerCase(),known:true,label:''};
 return {background:'#f1f5f9',known:false,label:input.trim().charAt(0).toUpperCase()||'?'};
}
