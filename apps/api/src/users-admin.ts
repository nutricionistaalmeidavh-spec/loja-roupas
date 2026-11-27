import type {FastifyInstance} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import {requirePermission} from './auth.ts';
import {DomainError,requireIdempotencyKey,withIdempotentTransaction} from './transactions.ts';
import {hashPassword} from './security.ts';

const uuid='^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$';
const params={type:'object',required:['id'],properties:{id:{type:'string',pattern:uuid}}};
export const STORE_ROLES=['manager','cashier','seller','stocker','buyer','technician'] as const;
type Role=typeof STORE_ROLES[number];
const rolesSchema={type:'array',minItems:1,maxItems:STORE_ROLES.length,uniqueItems:true,
 items:{type:'string',enum:[...STORE_ROLES]}} as const;

function cleanLogin(value:string){
 const login=value.trim().toLowerCase();
 if(!/^[a-z0-9._-]{3,64}$/.test(login))
  throw new DomainError(422,'LOGIN_INVALID','Login deve ter de 3 a 64 letras minúsculas, números, ponto, hífen ou sublinhado');
 return login;
}
function cleanName(value:string|undefined|null){
 if(value===undefined||value===null)return null;
 const name=value.trim();
 if(name.length<2||name.length>120)throw new DomainError(422,'NAME_INVALID','Nome deve ter de 2 a 120 caracteres');
 return name;
}
async function passwordHash(password:string){
 try{return await hashPassword(password);}
 catch{throw new DomainError(422,'PASSWORD_WEAK','Senha deve ter pelo menos 12 caracteres');}
}
/** Impede que a loja fique sem nenhum gestor ativo. */
async function ensureAnotherManager(client:PoolClient,storeId:string,userId:string){
 const others=await client.query(`SELECT 1 FROM user_store_roles r JOIN users u ON u.id=r.user_id
  WHERE r.store_id=$1 AND r.role_code='manager' AND u.status='active' AND u.id<>$2 LIMIT 1`,[storeId,userId]);
 if(!others.rowCount)throw new DomainError(409,'LAST_MANAGER','A loja precisa de pelo menos um gestor ativo');
}
async function memberRoles(client:PoolClient,storeId:string,userId:string){
 const q=await client.query<{role_code:string}>(`SELECT role_code FROM user_store_roles
  WHERE store_id=$1 AND user_id=$2 FOR UPDATE`,[storeId,userId]);
 if(!q.rowCount)throw new DomainError(404,'USER_NOT_FOUND','Usuário não pertence a esta loja');
 return q.rows.map(r=>r.role_code);
}

export function registerUsersAdmin(app:FastifyInstance,db:Pool){
 app.get('/v1/management/users',async(req,reply)=>{
  if(requirePermission(req,reply,'users.manage'))return reply;
  const q=await db.query(`SELECT u.id::text,u.login,u.display_name,u.status,u.created_at,
    array_agg(r.role_code ORDER BY r.role_code) AS roles,
    EXISTS(SELECT 1 FROM retail_operator_pins p WHERE p.store_id=$1 AND p.user_id=u.id) AS pin_ready
   FROM users u JOIN user_store_roles r ON r.user_id=u.id AND r.store_id=$1
   GROUP BY u.id ORDER BY u.status,lower(coalesce(u.display_name,u.login)) LIMIT 500`,[req.authContext!.storeId]);
  return {items:q.rows,roles:STORE_ROLES};
 });

 app.post<{Body:{login:string;display_name?:string;password:string;roles:Role[]}}>('/v1/management/users',{
  schema:{body:{type:'object',additionalProperties:false,required:['login','password','roles'],properties:{
   login:{type:'string',minLength:3,maxLength:64},display_name:{type:'string',maxLength:120},
   password:{type:'string',minLength:12,maxLength:1024},roles:rolesSchema}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'users.manage'))return reply;
  const auth=req.authContext!,login=cleanLogin(req.body.login),name=cleanName(req.body.display_name);
  const roles=[...new Set(req.body.roles)].sort();
  const hash=await passwordHash(req.body.password);
  // A senha não entra na impressão digital da idempotência.
  const out=await withIdempotentTransaction(db,auth,'users.create',requireIdempotencyKey(req.headers['idempotency-key']),
   {login,name,roles},async client=>{
    const exists=await client.query('SELECT 1 FROM users WHERE login=$1',[login]);
    if(exists.rowCount)throw new DomainError(409,'LOGIN_TAKEN','Já existe um usuário com este login');
    const user=await client.query<{id:string}>(`INSERT INTO users(login,password_hash,display_name)
     VALUES($1,$2,$3) RETURNING id::text`,[login,hash,name]);
    for(const role of roles)await client.query(`INSERT INTO user_store_roles(user_id,store_id,role_code)
     VALUES($1,$2,$3)`,[user.rows[0].id,auth.storeId,role]);
    await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
     VALUES($1,$2,'users.create',$3,$4::jsonb)`,[auth.storeId,auth.userId,user.rows[0].id,JSON.stringify({login,roles})]);
    return {id:user.rows[0].id,login,display_name:name,roles,status:'active'};
   });
  return reply.code(out.replayed?200:201).send(out.result);
 });

 app.put<{Params:{id:string};Body:{display_name?:string|null;roles?:Role[];status?:'active'|'blocked'}}>('/v1/management/users/:id',{
  schema:{params,body:{type:'object',additionalProperties:false,minProperties:1,properties:{
   display_name:{type:['string','null'],maxLength:120},roles:rolesSchema,status:{type:'string',enum:['active','blocked']}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'users.manage'))return reply;
  const auth=req.authContext!,id=req.params.id,body=req.body;
  const out=await withIdempotentTransaction(db,auth,'users.update:'+id,requireIdempotencyKey(req.headers['idempotency-key']),
   body,async client=>{
    const current=await memberRoles(client,auth.storeId,id);
    const losesManager=current.includes('manager')&&(body.status==='blocked'||(body.roles&&!body.roles.includes('manager')));
    if(losesManager)await ensureAnotherManager(client,auth.storeId,id);
    if('display_name' in body)await client.query('UPDATE users SET display_name=$2 WHERE id=$1',[id,cleanName(body.display_name)]);
    if(body.roles){
     await client.query('DELETE FROM user_store_roles WHERE store_id=$1 AND user_id=$2',[auth.storeId,id]);
     for(const role of [...new Set(body.roles)])await client.query(`INSERT INTO user_store_roles(user_id,store_id,role_code)
      VALUES($1,$2,$3)`,[id,auth.storeId,role]);
    }
    if(body.status){
     await client.query('UPDATE users SET status=$2 WHERE id=$1',[id,body.status]);
     if(body.status==='blocked')await client.query(`UPDATE auth_sessions SET revoked_at=now()
      WHERE user_id=$1 AND revoked_at IS NULL`,[id]);
    }
    await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
     VALUES($1,$2,'users.update',$3,$4::jsonb)`,[auth.storeId,auth.userId,id,JSON.stringify(body)]);
    return {id,updated:true};
   });
  return out.result;
 });

 app.post<{Params:{id:string};Body:{password:string}}>('/v1/management/users/:id/password',{
  schema:{params,body:{type:'object',additionalProperties:false,required:['password'],
   properties:{password:{type:'string',minLength:12,maxLength:1024}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'users.manage'))return reply;
  const auth=req.authContext!,id=req.params.id,hash=await passwordHash(req.body.password);
  const out=await withIdempotentTransaction(db,auth,'users.password:'+id,requireIdempotencyKey(req.headers['idempotency-key']),
   {id},async client=>{
    await memberRoles(client,auth.storeId,id);
    await client.query('UPDATE users SET password_hash=$2 WHERE id=$1',[id,hash]);
    // Outros aparelhos precisam entrar de novo; a sessão de quem trocou a própria senha continua.
    await client.query(`UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL
     AND token_hash<>$2`,[id,auth.tokenHash]);
    await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id)
     VALUES($1,$2,'users.password.reset',$3)`,[auth.storeId,auth.userId,id]);
    return {id,password_changed:true};
   });
  return out.result;
 });

 app.get('/v1/management/store-profile',async(req,reply)=>{
  if(requirePermission(req,reply,'catalog.read'))return reply;
  const q=await db.query(`SELECT name,legal_name,document,address,phone,receipt_footer,max_cashier_discount_bps,commission_timing,pix_key,pix_city
   FROM stores WHERE id=$1`,[req.authContext!.storeId]);
  return q.rows[0];
 });
 type Profile={name:string;legal_name?:string|null;document?:string|null;address?:string|null;phone?:string|null;
  receipt_footer?:string|null;max_cashier_discount_bps:number;commission_timing?:'on_sale'|'on_payment';
  pix_key?:string|null;pix_city?:string|null};
 app.put<{Body:Profile}>('/v1/management/store-profile',{
  schema:{body:{type:'object',additionalProperties:false,required:['name','max_cashier_discount_bps'],properties:{
   name:{type:'string',minLength:1,maxLength:120},legal_name:{type:['string','null'],maxLength:160},
   document:{type:['string','null'],maxLength:32},address:{type:['string','null'],maxLength:240},
   phone:{type:['string','null'],maxLength:32},receipt_footer:{type:['string','null'],maxLength:240},
   max_cashier_discount_bps:{type:'integer',minimum:0,maximum:10000},
   commission_timing:{type:'string',enum:['on_sale','on_payment']},
   pix_key:{type:['string','null'],maxLength:77},pix_city:{type:['string','null'],maxLength:60}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'users.manage'))return reply;
  const auth=req.authContext!,b=req.body;
  const opt=(v:string|null|undefined)=>v&&v.trim()?v.trim():null;
  const profile={name:b.name.trim(),legal_name:opt(b.legal_name),document:opt(b.document),address:opt(b.address),
   phone:opt(b.phone),receipt_footer:opt(b.receipt_footer),max_cashier_discount_bps:b.max_cashier_discount_bps,
   commission_timing:b.commission_timing??null,pix_key:opt(b.pix_key),pix_city:opt(b.pix_city)};
  if(!profile.name)throw new DomainError(422,'STORE_NAME','Informe o nome da loja');
  const out=await withIdempotentTransaction(db,auth,'store.profile',requireIdempotencyKey(req.headers['idempotency-key']),
   profile,async client=>{
    try{
     await client.query(`UPDATE stores SET name=$2,legal_name=$3,document=$4,address=$5,phone=$6,receipt_footer=$7,
      max_cashier_discount_bps=$8,commission_timing=coalesce($9,commission_timing),pix_key=$10,pix_city=$11 WHERE id=$1`,[auth.storeId,profile.name,
      profile.legal_name,profile.document,profile.address,profile.phone,profile.receipt_footer,profile.max_cashier_discount_bps,
      profile.commission_timing,profile.pix_key,profile.pix_city]);
    }catch(error){
     if((error as {code?:string}).code==='23514')throw new DomainError(422,'STORE_PROFILE','Confira o tamanho dos campos da loja');
     throw error;
    }
    await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
     VALUES($1,$2,'store.profile.update',$1,$3::jsonb)`,[auth.storeId,auth.userId,JSON.stringify(profile)]);
    return profile;
   });
  return out.result;
 });
}
