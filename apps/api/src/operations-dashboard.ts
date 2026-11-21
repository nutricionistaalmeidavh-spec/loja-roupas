import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import type {OperationalCounts,OperationalSummary} from '@loja/domain/operations';
import {requirePermission} from './auth.ts';

/**
 * Resumo operacional canônico: cada indicador é agregado no PostgreSQL e
 * isolado pelo mesmo store_id. Não somar dados de várias telas no navegador.
 */
const countsSql=`SELECT
  (SELECT count(*)::int FROM purchase_orders
    WHERE store_id=$1 AND received_at IS NULL) AS purchases_to_receive,
  (SELECT coalesce(sum(rejected_quantity),0)::int FROM purchase_orders
    WHERE store_id=$1 AND quality_finalized) AS purchase_quarantine_units,
  (SELECT coalesce(sum(missing_quantity),0)::int FROM purchase_orders
    WHERE store_id=$1 AND quality_finalized) AS purchase_missing_units,
  (SELECT count(*)::int FROM pickup_orders
    WHERE store_id=$1 AND sale_id IS NULL AND cancelled_at IS NULL
      AND created_at>now()-interval '48 hours') AS pickups_pending,
  (SELECT count(*)::int FROM stock_holds
    WHERE store_id=$1 AND released_at IS NULL) AS holds_active,
  (SELECT count(*)::int FROM receipt_print_requests
    WHERE store_id=$1 AND completed_at IS NULL) AS print_jobs_pending,
  (SELECT coalesce(sum(quantity),0)::int FROM cash_return_lines
    WHERE store_id=$1 AND disposition='quarantine') AS returned_quarantine_units,
  (SELECT count(*)::int FROM sales
    WHERE store_id=$1 AND status='partially_returned') AS partially_returned_sales,
  (SELECT count(*)::int FROM stock_balances
    WHERE store_id=$1 AND on_hand-reserved BETWEEN 0 AND 3) AS low_stock_variants`;

export function registerOperationsDashboard(app:FastifyInstance,db:Pool){
  app.get('/v1/management/operations/summary',async(request,reply):Promise<OperationalSummary|typeof reply>=>{
    if(requirePermission(request,reply,'intelligence.read'))return reply;
    const {rows:[counts]}=await db.query<OperationalCounts>(countsSql,[request.authContext!.storeId]);
    return {counts,generated_at:new Date().toISOString()};
  });
}
