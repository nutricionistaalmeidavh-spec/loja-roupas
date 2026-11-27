/**
 * Contratos de fluxos da loja. Máquina determinística: UI e API compartilham
 * estados e eventos, sem dependência de SaaS ou runtime de terceiros.
 *
 * As transições permanecem condicionadas às verificações transacionais do
 * PostgreSQL — esta tabela NÃO substitui validação de saldo nem RBAC.
 */
const transitions={
  purchase:{
    awaiting_receipt:{receive:'checked'},
    checked:{},
    legacy_receipt:{},
  },
  pickup:{
    pending:{cancel:'cancelled',complete:'completed',expire:'expired'},
    cancelled:{},
    completed:{},
    expired:{},
  },
  sale_return:{
    confirmed:{partial:'partially_returned',complete:'returned'},
    partially_returned:{partial:'partially_returned',complete:'returned'},
    returned:{},
    cancelled:{},
  },
  hold:{
    active:{release:'released'},
    released:{},
  },
} as const;

export type FlowName=keyof typeof transitions;
export type FlowState<F extends FlowName>=keyof typeof transitions[F] & string;
export type PurchaseState=FlowState<'purchase'>;
export type PickupState=FlowState<'pickup'>;
export type SaleReturnState=FlowState<'sale_return'>;
export type HoldState=FlowState<'hold'>;

/** Transição proibida (ou desconhecida) retorna null; não autoriza mutation. */
export function transition<F extends FlowName>(flow:F,state:FlowState<F>,event:string):FlowState<F>|null {
  const options=transitions[flow] as Record<string,Record<string,string>>;
  return (options[state]?.[event]??null) as FlowState<F>|null;
}

export function purchaseState(value:{received_at:string|null;quality_finalized:boolean}):PurchaseState{
  return !value.received_at?'awaiting_receipt':value.quality_finalized?'checked':'legacy_receipt';
}

const pickupTtlMs=48*60*60*1000;
export function pickupState(value:{
  sale_id:string|null;cancelled_at:string|null;created_at:string;
},now:Date=new Date()):PickupState {
  if(value.sale_id)return 'completed';
  if(value.cancelled_at)return 'cancelled';
  const created=Date.parse(value.created_at);
  if(!Number.isFinite(created))throw new Error('Data inválida de pedido de retirada');
  return now.getTime()-created>=pickupTtlMs?'expired':'pending';
}

export function saleReturnState(sold:number,returned:number):SaleReturnState {
  if(!Number.isSafeInteger(sold)||sold<1||!Number.isSafeInteger(returned)||returned<0||returned>sold)
    throw new Error('Quantidade de devolução inválida');
  return returned===0?'confirmed':returned===sold?'returned':'partially_returned';
}

export function holdState(value:{released_at:string|null}):HoldState{
  return value.released_at?'released':'active';
}

export type PurchaseReceiptRequest={
  received_quantity:number;
  accepted_quantity:number;
  reason?:string;
};
export type PurchaseReceiptResult={
  id:string;received:true;
  received_quantity:number;accepted_quantity:number;
  rejected_quantity:number;missing_quantity:number;
};
export type PurchaseRecord={
  id:string;supplier:string;sku:string;
  quantity:number;unit_cost_cents:string;
  received_at:string|null;promised_on:string|null;
  accepted_quantity:number|null;received_quantity:number|null;
  rejected_quantity:number|null;missing_quantity:number|null;
  quality_finalized:boolean;
};
export type ReturnItem={
  sale_line_id:string;quantity:number;condition:'resellable'|'quarantine';
};
export type CashReturnRequest={
  cash_session_id:string;reason:string;items:ReturnItem[];
};
export type SaleReturnLine={
  id:string;variant_id:string;product_name:string;sku:string;color:string;size:string;
  quantity:number;unit_price_cents:number;line_total_cents:number;returned_quantity:number;available_to_return:number;
};
export type SaleReturnLookup={
  id:string;sale_number:string;status:SaleReturnState;total_cents:string;cash_only:boolean;
  lines:SaleReturnLine[];
};
export type OperationalCounts={
  purchases_to_receive:number;
  purchase_quarantine_units:number;
  purchase_missing_units:number;
  pickups_pending:number;
  holds_active:number;
  print_jobs_pending:number;
  returned_quarantine_units:number;
  partially_returned_sales:number;
  low_stock_variants:number;
};
export type OperationalSummary={counts:OperationalCounts;generated_at:string};
