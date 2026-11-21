import {toSalesBars} from './sales-visual.ts';
import type {SaleDay} from './sales-visual.ts';

const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const fmt=(value:string)=>money.format(Number(BigInt(value))/100);
export function SalesBars({days}:{days:readonly SaleDay[]}){
 const bars=toSalesBars(days);
 const hasSales=bars.some(item=>item.percent>0);
 return <div className="sales-insight" role="region" aria-label="Evolução de vendas">
   <div className="sales-insight-head"><div>
     <h3>Vendas diárias</h3>
     <p>Últimos {bars.length} dias com registro no período consultado · valor líquido</p>
   </div><span className="sales-insight-key"><i aria-hidden="true"/> Vendas confirmadas</span></div>
   {hasSales?<div className="sales-bars" role="img" aria-label={bars.map(bar=>bar.day+': '+fmt(bar.netCents)).join('; ')}>
     {bars.map(bar=><div key={bar.day} className="sales-bar-item" title={bar.day+' · '+fmt(bar.netCents)+' · '+bar.count+' vendas'}>
       <div className="sales-bar-track"><span style={{height:bar.percent+'%'}}/></div>
       <span className="sales-bar-date">{bar.day.slice(8,10)+'/'+bar.day.slice(5,7)}</span>
     </div>)}
   </div>:<div className="sales-empty" role="status"><strong>Nenhuma venda líquida no período</strong><p>O gráfico será preenchido com vendas confirmadas da loja. Nenhum dado de exemplo é utilizado.</p></div>}
 </div>;
}
export function RetailEmpty({title,description}:{title:string;description:string}){
 return <div className="retail-empty"><strong>{title}</strong><p>{description}</p></div>;
}
