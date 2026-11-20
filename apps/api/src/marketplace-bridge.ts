import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import {requirePermission} from './auth.ts';
import {DomainError} from './transactions.ts';
import {isMarketplaceSlug,isMarketplaceKey,marketplaceBaseUrl} from './marketplace-sync-core.ts';
import {sealSyncKey} from './marketplace-secrets.ts';
import {syncMarketplaceStore} from './marketplace-sync.ts';

const uuid='^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$';
const uuidParam={type:'string',pattern:uuid};
const orderParams={type:'object',required:['id'],properties:{id:uuidParam}};
type Decision='accepted'|'rejected';
export async function decideMarketplaceOrder(db:Pool,storeId:string,remoteId:string,decision:Decision){
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  const found=await client.query<{status:string}>(
   'SELECT status FROM marketplace_orders WHERE store_id=$1 AND remote_id=$2 FOR UPDATE',[storeId,remoteId]);
  if(!found.rowCount)throw new DomainError(404,'ONLINE_ORDER_NOT_FOUND','Solicitação não encontrada nesta loja');
  const previous=found.rows[0].status;
  if(previous===decision){await client.query('COMMIT');return {id:remoteId,status:decision,idempotent:true};}
  if(previous==='rejected'||(previous==='accepted'&&decision==='accepted'))
   throw new DomainError(409,'ONLINE_ORDER_FINAL','Solicitação já finalizada');
  const lines=await client.query<{variant_id:string;quantity:number}>(
   'SELECT variant_id::text,quantity FROM marketplace_order_lines WHERE store_id=$1 AND remote_id=$2 ORDER BY variant_id',
   [storeId,remoteId]);
  if(!lines.rowCount)throw new DomainError(409,'ONLINE_ORDER_EMPTY','Pedido sem itens');
  const delta=decision==='accepted'?1:previous==='accepted'?-1:0;
  if(delta!==0){
   for(const line of lines.rows){
    const change=delta===1?
      await client.query<{revision:string}>(
       'UPDATE stock_balances SET reserved=reserved+$3,revision=revision+1 WHERE store_id=$1 AND variant_id=$2 AND on_hand-reserved>=$3 RETURNING revision::text',
       [storeId,line.variant_id,line.quantity]):
      await client.query<{revision:string}>(
       'UPDATE stock_balances SET reserved=reserved-$3,revision=revision+1 WHERE store_id=$1 AND variant_id=$2 AND reserved>=$3 RETURNING revision::text',
       [storeId,line.variant_id,line.quantity]);
    if(!change.rowCount)throw new DomainError(409,'ONLINE_STOCK_CONFLICT',
      'Peça indisponível ou sem reserva; confirme as quantidades no estoque');
    await client.query('INSERT INTO outbox_events(store_id,event_type,aggregate_id,aggregate_revision,payload) VALUES($1,$2,$3,$4,$5::jsonb)',
      [storeId,'inventory.stock.changed.v1',line.variant_id,change.rows[0].revision,
       JSON.stringify({variant_id:line.variant_id,order_id:remoteId,reserved_delta:delta*line.quantity})]);
   }
  }
  await client.query('UPDATE marketplace_orders SET status=$3,updated_at=now() WHERE store_id=$1 AND remote_id=$2',
   [storeId,remoteId,decision]);
  await client.query('COMMIT');
  return {id:remoteId,status:decision,idempotent:false};
 }catch(error){await client.query('ROLLBACK');throw error;}
 finally{client.release();}
}
export function registerMarketplaceBridge(app:FastifyInstance,db:Pool){
 app.get('/v1/management/marketplace/status',async(request,reply)=>{
  if(requirePermission(request,reply,'storefront.publish'))return reply;
  const store=request.authContext!.storeId;
  const result=await db.query<{slug:string;enabled:boolean;last_attempt_at:string|null;last_success_at:string|null;last_error:string|null}>(
   'SELECT slug,enabled,last_attempt_at,last_success_at,last_error FROM marketplace_links WHERE store_id=$1',[store]);
  const [waiting,pending]=await Promise.all([
   db.query<{count:string}>("SELECT count(*)::text AS count FROM marketplace_orders WHERE store_id=$1 AND status='pending'",[store]),
   db.query<{count:string}>('SELECT count(*)::text AS count FROM marketplace_listings WHERE store_id=$1 AND revision>delivered_revision',[store])
  ]);
  return {configured:(result.rowCount??0)>0,connected:result.rows[0]??null,
    pending_orders:Number(waiting.rows[0].count),pending_changes:Number(pending.rows[0].count),
    marketplace_url:marketplaceBaseUrl().href};
 });
 app.post<{Body:{slug:string;sync_key:string}}>('/v1/management/marketplace/connect',{
  schema:{body:{type:'object',additionalProperties:false,required:['slug','sync_key'],properties:{
   slug:{type:'string',minLength:3,maxLength:48},
   sync_key:{type:'string',minLength:64,maxLength:64}
  }}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'storefront.publish'))return reply;
  const {slug,sync_key}=request.body,store=request.authContext!.storeId;
  if(!isMarketplaceSlug(slug)||!isMarketplaceKey(sync_key))
   throw new DomainError(400,'ONLINE_CONNECTION_INVALID','Identificador da loja ou chave inválidos');
  const base=marketplaceBaseUrl();
  let response:Response;
  try{
   response=await fetch(new URL('/v1/sync/identity',base),{
    headers:{authorization:'Bearer '+sync_key},redirect:'manual',signal:AbortSignal.timeout(8000)
   });
  }catch{throw new DomainError(503,'ONLINE_UNAVAILABLE','Não foi possível verificar a licença da vitrine online');}
  if(!response.ok)throw new DomainError(403,'ONLINE_KEY_INVALID','Licença ou chave de sincronização inválida');
  const identity=await response.json() as {slug?:unknown};
  if(identity.slug!==slug)throw new DomainError(409,'ONLINE_TENANT_MISMATCH','Esta chave pertence a outra vitrine');
  const current=await db.query<{slug:string}>('SELECT slug FROM marketplace_links WHERE store_id=$1',[store]);
  if(current.rowCount&&current.rows[0].slug!==slug)
   throw new DomainError(409,'ONLINE_REBIND_BLOCKED','Esta loja já está vinculada a outra vitrine; revise a migração antes de alterar');
  const encrypted=await sealSyncKey(sync_key);
  await db.query('INSERT INTO marketplace_links(store_id,slug,secret_encrypted,enabled) VALUES($1,$2,$3,true)'+
   ' ON CONFLICT(store_id) DO UPDATE SET secret_encrypted=excluded.secret_encrypted,enabled=true',
   [store,slug,encrypted]);
  return reply.code(201).send({connected:true,slug,marketplace_url:new URL('/loja/'+slug,base).href});
 });
 app.patch<{Body:{enabled:boolean}}>('/v1/management/marketplace',{
  schema:{body:{type:'object',additionalProperties:false,required:['enabled'],properties:{enabled:{type:'boolean'}}}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'storefront.publish'))return reply;
  const updated=await db.query('UPDATE marketplace_links SET enabled=$2 WHERE store_id=$1 RETURNING enabled',
   [request.authContext!.storeId,request.body.enabled]);
  if(!updated.rowCount)throw new DomainError(404,'ONLINE_NOT_CONFIGURED','Vitrine não configurada');
  return {enabled:updated.rows[0].enabled};
 });
 app.post('/v1/management/marketplace/sync-now',async(request,reply)=>{
  if(requirePermission(request,reply,'storefront.publish'))return reply;
  const result=await syncMarketplaceStore(db,request.authContext!.storeId);
  return result;
 });
 app.get('/v1/management/marketplace/orders',async(request,reply)=>{
  if(requirePermission(request,reply,'storefront.publish'))return reply;
  const store=request.authContext!.storeId;
  const r=await db.query<{
   remote_id:string;customer_name:string;customer_phone:string;status:string;remote_status:string;created_at:string;lines:Array<{sku:string|null;name:string|null;quantity:number}>;
  }>('SELECT o.remote_id::text,o.customer_name,o.customer_phone,o.status,o.remote_status,o.created_at,'+
   ' coalesce((SELECT json_agg(json_build_object('+
   " 'sku',v.sku,'name',p.name,'quantity',l.quantity) ORDER BY l.variant_id) "+
   ' FROM marketplace_order_lines l LEFT JOIN product_variants v ON v.store_id=l.store_id AND v.id=l.variant_id'+
   ' LEFT JOIN products p ON p.store_id=v.store_id AND p.id=v.product_id'+
   ' WHERE l.store_id=o.store_id AND l.remote_id=o.remote_id),'+
   " '[]'::json) AS lines FROM marketplace_orders o WHERE o.store_id=$1 "+
   ' ORDER BY o.created_at DESC,o.remote_id DESC LIMIT 100',[store]);
  return {orders:r.rows};
 });
 app.post<{Params:{id:string};Body:{decision:Decision}}>('/v1/management/marketplace/orders/:id/decision',{
  schema:{params:orderParams,body:{type:'object',additionalProperties:false,required:['decision'],properties:{
   decision:{type:'string',enum:['accepted','rejected']}
  }}}
 },async(request,reply)=>{
  if(requirePermission(request,reply,'storefront.publish'))return reply;
  return decideMarketplaceOrder(db,request.authContext!.storeId,request.params.id,request.body.decision);
 });
}
