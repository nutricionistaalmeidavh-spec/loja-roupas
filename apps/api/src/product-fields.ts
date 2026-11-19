import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import {requirePermission} from './auth.ts';
import {DomainError,requireIdempotencyKey,withIdempotentTransaction} from './transactions.ts';

const uuid={type:'string',pattern:'^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'};
const productParams={type:'object',required:['id'],properties:{id:uuid}};

export function registerProductFields(app:FastifyInstance,db:Pool) {
  app.get<{Params:{id:string}}>('/v1/management/products/:id/fields',{schema:{params:productParams}},async(request,reply)=>{
    if(requirePermission(request,reply,'intelligence.manage'))return reply;
    const {storeId}=request.authContext!,{id}=request.params;
    const product=await db.query('SELECT 1 FROM products WHERE store_id=$1 AND id=$2',[storeId,id]);
    if(!product.rowCount)throw new DomainError(404,'PRODUCT_NOT_FOUND','Produto indisponível nesta loja');
    const fields=await db.query(`SELECT f.id,f.label,v.value FROM product_field_definitions f
      LEFT JOIN product_field_values v ON v.store_id=f.store_id AND v.field_id=f.id AND v.product_id=$2
      WHERE f.store_id=$1 ORDER BY lower(f.label),f.id`,[storeId,id]);
    return {fields:fields.rows};
  });

  app.post<{Body:{label:string}}>('/v1/management/product-fields',{
    schema:{body:{type:'object',required:['label'],additionalProperties:false,properties:{
      label:{type:'string',minLength:1,maxLength:60,pattern:'\\S'},
    }}},
  },async(request,reply)=>{
    if(requirePermission(request,reply,'intelligence.manage'))return reply;
    const auth=request.authContext!,label=request.body.label.trim();
    const key=requireIdempotencyKey(request.headers['idempotency-key']);
    const out=await withIdempotentTransaction(db,auth,'product.fields.create',key,{label},async client=>{
      await client.query('SELECT id FROM stores WHERE id=$1 FOR NO KEY UPDATE',[auth.storeId]);
      const count=await client.query<{count:number}>('SELECT count(*)::int FROM product_field_definitions WHERE store_id=$1',[auth.storeId]);
      if(count.rows[0].count>=12)throw new DomainError(409,'FIELD_LIMIT','Limite de 12 campos personalizados atingido');
      const result=await client.query<{id:string;label:string}>(`INSERT INTO product_field_definitions (store_id,label)
        VALUES($1,$2) RETURNING id,label`,[auth.storeId,label]);
      const field=result.rows[0];
      await client.query("INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id) VALUES($1,$2,'product.fields.create',$3)",
        [auth.storeId,auth.userId,field.id]);
      return field;
    });
    return reply.code(201).send(out.result);
  });

  app.put<{Params:{id:string;fieldId:string};Body:{value:string}}>('/v1/management/products/:id/fields/:fieldId',{
    schema:{params:{type:'object',required:['id','fieldId'],properties:{id:uuid,fieldId:uuid}},
      body:{type:'object',required:['value'],additionalProperties:false,properties:{value:{type:'string',maxLength:240}}}},
  },async(request,reply)=>{
    if(requirePermission(request,reply,'intelligence.manage'))return reply;
    const auth=request.authContext!,{id,fieldId}=request.params,value=request.body.value.trim()||null;
    const key=requireIdempotencyKey(request.headers['idempotency-key']);
    const out=await withIdempotentTransaction(db,auth,'product.fields.value:'+id+':'+fieldId,key,{value},async client=>{
      const allowed=await client.query(`SELECT 1 FROM products p JOIN product_field_definitions f ON f.store_id=p.store_id
        WHERE p.store_id=$1 AND p.id=$2 AND f.id=$3`,[auth.storeId,id,fieldId]);
      if(!allowed.rowCount)throw new DomainError(404,'FIELD_NOT_FOUND','Campo ou produto indisponível nesta loja');
      if(value===null)await client.query('DELETE FROM product_field_values WHERE store_id=$1 AND product_id=$2 AND field_id=$3',
        [auth.storeId,id,fieldId]);
      else await client.query(`INSERT INTO product_field_values(store_id,product_id,field_id,value)
        VALUES($1,$2,$3,$4) ON CONFLICT(store_id,product_id,field_id) DO UPDATE SET value=EXCLUDED.value`,
        [auth.storeId,id,fieldId,value]);
      await client.query(`INSERT INTO audit_logs(store_id,actor_id,action,aggregate_id,detail)
        VALUES($1,$2,'product.fields.value',$3,$4::jsonb)`,
        [auth.storeId,auth.userId,id,JSON.stringify({field_id:fieldId,cleared:value===null})]);
      return {field_id:fieldId,value};
    });
    return out.result;
  });
}
