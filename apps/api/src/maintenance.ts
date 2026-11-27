import type {Pool} from 'pg';

/**
 * Limpeza periódica do banco local. Os eventos internos (outbox) ainda não têm leitor externo;
 * eles servem de rastro recente e não precisam crescer para sempre no computador da loja.
 */
export async function pruneOutbox(pool:Pick<Pool,'query'>,keepDays=90){
 const r=await pool.query(`DELETE FROM outbox_events WHERE occurred_at<now()-make_interval(days=>$1::int)`,[keepDays]);
 return r.rowCount??0;
}
export function startMaintenance(pool:Pool,log:(message:string)=>void){
 const run=()=>{void pruneOutbox(pool).catch(error=>log('Falha na limpeza de eventos: '+String(error)));};
 const first=setTimeout(run,60_000);
 const timer=setInterval(run,24*60*60_000);
 first.unref();timer.unref();
 return ()=>{clearTimeout(first);clearInterval(timer);};
}
