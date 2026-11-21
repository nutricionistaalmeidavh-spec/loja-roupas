import test from 'node:test';
import assert from 'node:assert/strict';
import {transition, purchaseState, pickupState, saleReturnState, holdState} from '../src/operations.ts';

test('P1: fluxo de pedido de compra exige conferência e não permite reabrir',()=>{
 assert.equal(purchaseState({received_at:null,quality_finalized:false}),'awaiting_receipt');
 assert.equal(transition('purchase','awaiting_receipt','receive'),'checked');
 assert.equal(transition('purchase','checked','receive'),null);
 assert.equal(purchaseState({received_at:'2026-11-21',quality_finalized:false}),'legacy_receipt');
 assert.equal(transition('purchase','legacy_receipt','receive'),null);
});
test('P1: retirada tem estados terminais e prioridade ao pago ou cancelado',()=>{
 const base={sale_id:null,cancelled_at:null,created_at:'2026-11-21T10:00:00Z'};
 assert.equal(pickupState(base,new Date('2026-11-21T11:00:00Z')),'pending');
 assert.equal(pickupState({...base,cancelled_at:'2026-11-21T11:00:00Z'},new Date('2026-11-25T10:00:00Z')),'cancelled');
 assert.equal(pickupState({...base,sale_id:'paid'},new Date('2026-11-25T10:00:00Z')),'completed');
 assert.equal(pickupState(base,new Date('2026-11-23T10:00:01Z')),'expired');
 assert.equal(transition('pickup','pending','cancel'),'cancelled');
 assert.equal(transition('pickup','pending','complete'),'completed');
 assert.equal(transition('pickup','cancelled','complete'),null);
 assert.equal(transition('pickup','expired','cancel'),null);
});
test('P1: devolução parcial até final sem repetir total e reserva terminal',()=>{
 assert.equal(saleReturnState(3,0),'confirmed');
 assert.equal(saleReturnState(3,1),'partially_returned');
 assert.equal(saleReturnState(3,3),'returned');
 assert.equal(transition('sale_return','confirmed','partial'),'partially_returned');
 assert.equal(transition('sale_return','partially_returned','complete'),'returned');
 assert.equal(transition('sale_return','returned','partial'),null);
 assert.throws(()=>saleReturnState(3,4),/inválida/);
 assert.equal(holdState({released_at:null}),'active');
 assert.equal(holdState({released_at:'2026-11-21'}),'released');
 assert.equal(transition('hold','active','release'),'released');
 assert.equal(transition('hold','released','release'),null);
});
