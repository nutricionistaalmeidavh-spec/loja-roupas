import {randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import {requirePermission} from './auth.ts';
import {DomainError} from './transactions.ts';
import {hashSessionToken,issueSession,verifyPassword} from './security.ts';
const uuid='^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$';
const derive=(pin:string,salt:Buffer)=>new Promise<Buffer>((resolve,reject)=>
 scrypt(pin,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024},(err,key)=>err?reject(err):resolve(key)));
export async function hashOperatorPin(pin:string){
 if(!/^\d{6,8}$/.test(pin))throw new DomainError(422,'PIN_INVALID','PIN precisa de 6 a 8 dígitos');
 const salt=randomBytes(16),hash=await derive(pin,salt);
 return 'scrypt-pin$v1$'+salt.toString('base64url')+'$'+hash.toString('base64url');
}
export async function verifyOperatorPin(pin:string,encoded:string){
 if(!/^\d{6,8}$/.test(pin)||typeof encoded!=='string')return false;
 const parts=encoded.split('$');
 if(parts.length!==4||parts[0]!=='scrypt-pin'||parts[1]!=='v1')return false;
 try{
  const salt=Buffer.from(parts[2],'base64url'),expected=Buffer.from(parts[3],'base64url');
  if(salt.length!==16||expected.length!==32)return false;
  return timingSafeEqual(await derive(pin,salt),expected);
 }catch{return false;}
}
export function registerOperatorPin(app:FastifyInstance,db:Pool){
 app.get('/v1/auth/operators',async(req,reply)=>{
  if(requirePermission(req,reply,'catalog.read'))return reply;
  const q=await db.query(`SELECT u.id::text,u.login,coalesce(bool_or(p.pin_hash IS NOT NULL),false) AS pin_ready
   FROM users u JOIN user_store_roles r ON r.user_id=u.id AND r.store_id=$1
   LEFT JOIN retail_operator_pins p ON p.store_id=$1 AND p.user_id=u.id
   WHERE u.status='active' GROUP BY u.id,u.login ORDER BY u.login LIMIT 100`,[req.authContext!.storeId]);
  return {items:q.rows};
 });
 app.post<{Body:{user_id:string;pin:string;manager_password:string}}>('/v1/auth/operators/pin',{
  schema:{body:{type:'object',additionalProperties:false,required:['user_id','pin','manager_password'],
   properties:{user_id:{type:'string',pattern:uuid},pin:{type:'string',pattern:'^[0-9]{6,8}$'},
    manager_password:{type:'string',minLength:1,maxLength:1024}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'system.backup'))return reply; // gerente ou técnico autorizado
  if(!req.authContext!.roles.includes('manager'))return reply.code(403).send({code:'FORBIDDEN'});
  const auth=req.authContext!,body=req.body;
  const actual=await db.query<{password_hash:string}>(`SELECT password_hash FROM users WHERE id=$1 AND status='active'`,[auth.userId]);
  if(!actual.rowCount||!await verifyPassword(body.manager_password,actual.rows[0].password_hash))
   throw new DomainError(403,'PASSWORD_REQUIRED','Senha de gerente inválida');
  const target=await db.query(`SELECT 1 FROM users u JOIN user_store_roles r ON u.id=r.user_id
    WHERE u.id=$1 AND r.store_id=$2 AND u.status='active'`,[body.user_id,auth.storeId]);
  if(!target.rowCount)throw new DomainError(404,'OPERATOR_NOT_FOUND','Operador não cadastrado nesta loja');
  const hash=await hashOperatorPin(body.pin);
  await db.query(`INSERT INTO retail_operator_pins
   (store_id,user_id,pin_hash,updated_by) VALUES($1,$2,$3,$4)
   ON CONFLICT(store_id,user_id) DO UPDATE SET pin_hash=EXCLUDED.pin_hash,
    failed_attempts=0,locked_until=NULL,updated_by=EXCLUDED.updated_by,updated_at=now()`,
   [auth.storeId,body.user_id,hash,auth.userId]);
  await db.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id)
   VALUES($1,$2,'operator.pin.set',$3)`,[auth.storeId,auth.userId,body.user_id]);
  return {configured:true,user_id:body.user_id};
 });
 app.post<{Body:{user_id:string;pin:string}}>('/v1/auth/operators/switch',{
  schema:{body:{type:'object',additionalProperties:false,required:['user_id','pin'],
   properties:{user_id:{type:'string',pattern:uuid},pin:{type:'string',minLength:1,maxLength:8}}}}
 },async(req,reply)=>{
  if(requirePermission(req,reply,'catalog.read'))return reply;
  const auth=req.authContext!,body=req.body,client=await db.connect();
  try{
   await client.query('BEGIN');
   const p=await client.query<{pin_hash:string;failed_attempts:number;locked_until:Date|null}>(`
     SELECT pin_hash,failed_attempts,locked_until FROM retail_operator_pins
     WHERE store_id=$1 AND user_id=$2 FOR UPDATE`,[auth.storeId,body.user_id]);
   const target=await client.query<{login:string;roles:string[]}>(`SELECT u.login,
    array_agg(r.role_code) AS roles FROM users u JOIN user_store_roles r ON u.id=r.user_id
    WHERE u.status='active' AND r.store_id=$1 AND u.id=$2 GROUP BY u.id,u.login`,[auth.storeId,body.user_id]);
   if(!p.rowCount||!target.rowCount)throw new DomainError(401,'INVALID_PIN','Operador/PIN inválido');
   const row=p.rows[0];
   if(row.locked_until&&new Date(row.locked_until).getTime()>Date.now()){
    await client.query('COMMIT');
    return reply.code(429).send({code:'PIN_LOCKED',message:'PIN temporariamente bloqueado. Aguarde 15 minutos.'});
   }
   if(!await verifyOperatorPin(body.pin,row.pin_hash)){
    const attempts=(row.failed_attempts||0)+1;
    await client.query(`UPDATE retail_operator_pins SET failed_attempts=$3,
     locked_until=CASE WHEN $3>=5 THEN now()+interval '15 minutes' ELSE NULL END
     WHERE store_id=$1 AND user_id=$2`,[auth.storeId,body.user_id,Math.min(attempts,5)]);
    await client.query('COMMIT');
    return reply.code(attempts>=5?429:401).send({code:'INVALID_PIN',
     message:attempts>=5?'PIN bloqueado por 15 minutos.':'PIN inválido'});
   }
   await client.query(`UPDATE retail_operator_pins SET failed_attempts=0,locked_until=NULL
    WHERE store_id=$1 AND user_id=$2`,[auth.storeId,body.user_id]);
   const issued=issueSession();
   await client.query(`INSERT INTO auth_sessions(user_id,token_hash,expires_at)
    VALUES($1,$2,now()+interval '8 hours')`,[body.user_id,issued.tokenHash]);
   await client.query(`UPDATE auth_sessions SET revoked_at=now()
    WHERE token_hash=$1 AND revoked_at IS NULL`,[auth.tokenHash]);
   await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
    VALUES($1,$2,'operator.pin.switch',$3,$4::jsonb)`,
    [auth.storeId,auth.userId,body.user_id,JSON.stringify({from_user_id:auth.userId})]);
   await client.query('COMMIT');
   reply.header('Cache-Control','no-store');
   return {token:issued.token,store_id:auth.storeId,user_id:body.user_id,
    login:target.rows[0].login,roles:target.rows[0].roles};
  }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
 });
}
