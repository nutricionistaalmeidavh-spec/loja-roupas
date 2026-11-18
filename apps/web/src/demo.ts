import type { Variant } from '@loja/domain';
// Dados sintéticos APENAS para revisão da UI. Não representam estoque ou vendas.
export type Product = { id: string; name: string; category: string; kind: 'shirt'|'pants'|'bag'|'shoe'; variants: Variant[] };
const make = (id: string, sku: string, color: string, size: string, priceCents: number, available: number): Variant =>
  ({ id, sku, color, size, priceCents, available });
export const products: Product[] = [
  { id:'camisa',name:'Camisa de linho',category:'Masculino',kind:'shirt',variants:[
    make('c-m','CAM-AZ-M','Azul','M',14990,2),make('c-g','CAM-AZ-G','Azul','G',14990,0),make('c-b','CAM-BG-M','Bege','M',14990,3)]},
  { id:'jeans',name:'Jeans slim',category:'Masculino',kind:'pants',variants:[
    make('j-40','JEA-PR-40','Preto','40',18990,2),make('j-42','JEA-PR-42','Preto','42',18990,4)]},
  { id:'polo',name:'Polo texturizada',category:'Masculino',kind:'shirt',variants:[
    make('p-m','POL-AR-M','Areia','M',11990,3),make('p-g','POL-AR-G','Areia','G',11990,3)]},
  { id:'bolsa',name:'Bolsa casual',category:'Acessórios',kind:'bag',variants:[
    make('b-u','BOL-BG-U','Bege','Único',8990,5)]},
  { id:'sapato',name:'Mocassim',category:'Acessórios',kind:'shoe',variants:[
    make('s-40','MOC-PR-40','Preto','40',22990,2),make('s-42','MOC-PR-42','Preto','42',22990,1)]},
  { id:'tee',name:'Camiseta básica',category:'Feminino',kind:'shirt',variants:[
    make('t-p','TEE-CZ-P','Cinza','P',7990,0),make('t-m','TEE-CZ-M','Cinza','M',7990,8)]},
];
