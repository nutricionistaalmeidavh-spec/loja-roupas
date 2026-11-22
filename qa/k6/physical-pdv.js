// Executar apenas sobre banco QA descartável.
import http from 'k6/http';
import {check,sleep} from 'k6';
export const options={scenarios:{retail_reads:{executor:'constant-vus',vus:5,duration:'20s'}},
 thresholds:{http_req_failed:['rate<0.01'],http_req_duration:['p(95)<1800']}};
const base=__ENV.LOJA_BASE_URL||'http://127.0.0.1:3000';
export function setup(){
 const res=http.post(base+'/v1/auth/sessions',
 JSON.stringify({login:'qa-admin',password:'Senha-QA-Somente-CI-2026'}),
 {headers:{'content-type':'application/json'}});
 if(res.status!==200)throw new Error('Login QA falhou: '+res.status);
 const data=res.json();
 return {token:data.token,storeId:data.stores[0].store_id};
}
export default function(auth){
 const cfg={headers:{authorization:'Bearer '+auth.token,'x-store-id':auth.storeId}};
 const a=http.get(base+'/v1/catalog/products?limit=50',cfg);
 const b=http.get(base+'/v1/stock/spreadsheet?limit=50',cfg);
 const c=http.get(base+'/v1/edition',cfg);
 check(a,{'catalogo 200':r=>r.status===200});
 check(b,{'estoque 200':r=>r.status===200});
 check(c,{'perfil 200':r=>r.status===200&&r.json('edition')==='physical'});
 sleep(0.2);
}
