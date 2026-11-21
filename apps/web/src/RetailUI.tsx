import {toSalesBars} from './sales-visual.ts';
import type {SaleDay} from './sales-visual.ts';

const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const fmt=(value:string)=>money.format(Number(BigInt(value))/100);
export function SalesBars({days,period='daily'}:{days:readonly SaleDay[];period?:'daily'|'monthly'}){
 const bars=toSalesBars(days,period==='monthly'?12:14);
 const hasSales=bars.some(item=>item.percent>0);
 return <div className="sales-insight" role="region" aria-label="Evolução de vendas">
   <div className="sales-insight-head"><div>
     <h3>{period==='monthly'?'Evolução mensal':'Vendas diárias'}</h3>
     <p>{period==='monthly'?'Últimos '+bars.length+' meses':'Últimos '+bars.length+' dias com registro'} · faturamento líquido em vendas confirmadas</p>
   </div><span className="sales-insight-key"><i aria-hidden="true"/> Vendas confirmadas</span></div>
   {hasSales?<div className="sales-bars" role="img" aria-label={bars.map(bar=>bar.day+': '+fmt(bar.netCents)).join('; ')}>
     {bars.map(bar=><div key={bar.day} className="sales-bar-item" title={bar.day+' · '+fmt(bar.netCents)+' · '+bar.count+' vendas'}>
       <div className="sales-bar-track"><span style={{height:bar.percent+'%'}}/></div>
       <span className="sales-bar-date">{period==='monthly'?bar.day.slice(5,7)+'/'+bar.day.slice(2,4):bar.day.slice(8,10)+'/'+bar.day.slice(5,7)}</span>
     </div>)}
   </div>:<div className="sales-empty" role="status"><strong>Nenhuma venda líquida no período</strong><p>O gráfico será preenchido com vendas confirmadas da loja. Nenhum dado de exemplo é utilizado.</p></div>}
 </div>;
}
export function RetailEmpty({title,description}:{title:string;description:string}){
 return <div className="retail-empty"><strong>{title}</strong><p>{description}</p></div>;
}
