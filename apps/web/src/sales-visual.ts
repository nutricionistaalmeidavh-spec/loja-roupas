export type SaleDay = {
 day:string;sale_count:number;gross_cents:string;refunded_cents:string;
};
export type SaleBar = {day:string; netCents:string;percent:number;count:number};
export function toSalesBars(days:readonly SaleDay[],limit=14):SaleBar[]{
 const rows=[...days].sort((a,b)=>a.day.localeCompare(b.day)).slice(-limit);
 const computed=rows.map(row=>{
  const net=BigInt(row.gross_cents)-BigInt(row.refunded_cents);
  return {day:row.day,count:row.sale_count,net};
 });
 const max=computed.reduce((highest,row)=>row.net>highest?row.net:highest,0n);
 return computed.map(({day,count,net})=>({
  day,count,netCents:String(net),
  percent:net>0n&&max>0n?Number(net*100n/max):0,
 }));
}
