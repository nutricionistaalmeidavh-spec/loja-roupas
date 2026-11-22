import test from 'node:test';
import assert from 'node:assert/strict';
import {hashOperatorPin,verifyOperatorPin} from '../src/operator-pin.ts';
test('PIN local usa sal aleatório e scrypt e não aparece em claro',async()=>{
 const hash=await hashOperatorPin('123456');
 assert.match(hash,/^scrypt-pin\$v1\$/);
 assert.ok(!hash.includes('123456'));
 assert.notEqual(await hashOperatorPin('123456'),hash);
 assert.equal(await verifyOperatorPin('123456',hash),true);
 assert.equal(await verifyOperatorPin('111111',hash),false);
 assert.equal(await verifyOperatorPin('12345',hash),false);
});
test('PIN pequeno é rejeitado e hash inválido falha fechado',async()=>{
 await assert.rejects(hashOperatorPin('1234'),/PIN/i);
 assert.equal(await verifyOperatorPin('123456','invalid'),false);
});
