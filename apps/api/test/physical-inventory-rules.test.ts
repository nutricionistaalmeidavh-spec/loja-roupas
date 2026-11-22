import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileCount} from '../src/physical-inventory-rules.ts';

test('reconciliação valida o saldo canônico antes de aplicar ajuste',()=>{
 assert.equal(reconcileCount({expected:10,current:10,counted:7,reserved:2}),-3);
 assert.equal(reconcileCount({expected:10,current:10,counted:12,reserved:0}),2);
 assert.throws(()=>reconcileCount({expected:10,current:9,counted:7,reserved:0}),/alterado/i);
});
test('reconciliação não pode criar estoque negativo ou inferior ao reservado',()=>{
 assert.throws(()=>reconcileCount({expected:10,current:10,counted:-1,reserved:0}));
 assert.throws(()=>reconcileCount({expected:10,current:10,counted:1,reserved:2}));
 assert.throws(()=>reconcileCount({expected:10,current:10,counted:1.5,reserved:0}));
});
