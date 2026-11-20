import {useEffect,useRef,useState} from 'react';
import './desktop-updates.css';

type Release={version:string;notes:string;size:number};
type State={supported:boolean;currentVersion:string;available:Release|null;message?:string};
type Progress={phase:string;bytes?:number;total?:number;message?:string;version?:string;backupCreated?:boolean};
type LastResult={status:string;message:string}|null;
type Bridge={
 check():Promise<State>;
 install():Promise<{started:boolean;cancelled?:boolean;backupCreated?:boolean}>;
 lastResult():Promise<LastResult>;
 onProgress(callback:(value:Progress)=>void):()=>void;
};
declare global{interface Window{lojaUpdates?:Bridge}}

function messageFor(progress:Progress|null){
 if(!progress)return '';
 switch(progress.phase){
  case 'preparing':return 'Preparando download autorizado…';
  case 'download':return 'Baixando instalador: '+(progress.total?Math.min(100,Math.round((progress.bytes||0)*100/progress.total))+'%':'em andamento');
  case 'verified':return 'Arquivo recebido e SHA-256 validado.';
  case 'checking-integrity':return 'Conferindo a integridade do instalador…';
  case 'backup':return 'Criando backup do PostgreSQL local antes de instalar…';
  case 'backup-complete':return 'Backup do banco concluído.';
  case 'installing':return 'Instalação autorizada. Fechando a loja com segurança…';
  case 'error':return progress.message||'Falha ao preparar a atualização.';
  default:return '';
 }
}
function Notes({release}:{release:Release}){
 return <div className="update-release">
  <div className="update-version-line"><span>Nova versão</span><strong>v{release.version}</strong></div>
  <h3>O que mudou</h3>
  <p className="update-notes">{release.notes.trim()||'Atualização de estabilidade e melhorias do sistema.'}</p>
  <p className="update-footnote">O download só começa depois da sua confirmação. A instalação usa SHA-256, cria backup local antes de aplicar e guarda uma cópia do programa anterior.</p>
 </div>;
}
export function UpdateStartupDialog(){
 const [release,setRelease]=useState<Release|null>(null);
 const [dismissed,setDismissed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [progress,setProgress]=useState<Progress|null>(null);
 const [error,setError]=useState('');
 const dialogRef=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const bridge=window.lojaUpdates;
  if(!bridge)return;
  let alive=true;
  const unsubscribe=bridge.onProgress(value=>{if(alive)setProgress(value);});
  void bridge.check().then(result=>{if(alive&&result.available)setRelease(result.available);}).catch(()=>{});
  return ()=>{alive=false;unsubscribe();};
 },[]);
 useEffect(()=>{
  const dialog=dialogRef.current;
  if(release&&!dismissed&&dialog&&!dialog.open)dialog.showModal();
  if((!release||dismissed)&&dialog?.open)dialog.close();
 },[release,dismissed]);
 async function install(){
  if(!window.lojaUpdates||busy)return;
  setBusy(true);setError('');
  try{
   const result=await window.lojaUpdates.install();
   if(result.cancelled)setBusy(false);
  }catch(err){
   setError(err instanceof Error?err.message:'Não foi possível preparar a atualização.');
   setBusy(false);
  }
 }
 if(!release||dismissed)return null;
 return <dialog ref={dialogRef} className="update-dialog" aria-labelledby="update-dialog-title"
    onCancel={event=>{if(busy){event.preventDefault();return;}setDismissed(true);}}>
  <div className="update-dialog-top">
   <p className="update-kicker">ATUALIZAÇÃO DISPONÍVEL</p>
   <h2 id="update-dialog-title">Uma nova versão da Loja de Roupas está disponível</h2>
   <p>Você decide quando atualizar. O sistema não baixa arquivos automaticamente.</p>
  </div>
  <Notes release={release}/>
  {progress&&<p className="update-progress" role="status">{messageFor(progress)}</p>}
  {error&&<p role="alert" className="update-error">{error}</p>}
  <div className="update-actions">
   <button type="button" className="update-secondary" disabled={busy} onClick={()=>setDismissed(true)}>Agora não</button>
   <button type="button" className="update-primary" disabled={busy} onClick={()=>void install()}>
    {busy?'Preparando atualização…':'Baixar e instalar'}
   </button>
  </div>
 </dialog>;
}
export function UpdateSettings(){
 const [state,setState]=useState<State|null>(null);
 const [progress,setProgress]=useState<Progress|null>(null);
 const [last,setLast]=useState<LastResult>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{
  const bridge=window.lojaUpdates;
  if(!bridge)return;
  let alive=true;
  const unsubscribe=bridge.onProgress(value=>{if(alive)setProgress(value);});
  void bridge.lastResult().then(result=>{if(alive)setLast(result);}).catch(()=>{});
  return ()=>{alive=false;unsubscribe();};
 },[]);
 async function check(){
  const bridge=window.lojaUpdates;
  if(!bridge)return;
  setBusy(true);setError('');setProgress(null);
  try{setState(await bridge.check());}
  catch(err){setError(err instanceof Error?err.message:'Não foi possível verificar atualizações.');}
  finally{setBusy(false);}
 }
 async function install(){
  const bridge=window.lojaUpdates;
  if(!bridge)return;
  setBusy(true);setError('');
  try{
   const result=await bridge.install();
   if(result.cancelled)setBusy(false);
  }catch(err){setError(err instanceof Error?err.message:'Não foi possível instalar.');setBusy(false);}
 }
 return <section className="update-settings" aria-label="Configurações de atualizações">
  <div className="update-settings-heading">
   <div><p className="update-kicker">CONFIGURAÇÕES</p><h2>Atualizações do sistema</h2>
   <p>Consulte novas versões oficiais do GitHub. Nenhum instalador será baixado sem sua autorização.</p></div>
  </div>
  {!window.lojaUpdates?<p className="update-footnote">A atualização do aplicativo Windows é gerenciada no computador onde o programa está instalado. Acesso pelo navegador não instala atualizações.</p>:<>
   <p className="update-footnote">Versão instalada: <strong>{state?.currentVersion?'v'+state.currentVersion:'consulte abaixo'}</strong></p>
   <button type="button" className="update-secondary" disabled={busy} onClick={()=>void check()}>
    {busy?'Verificando…':'Verificar atualizações agora'}
   </button>
   {state?.available?<Notes release={state.available}/>:
    state&&<p role="status">{state.message||(state.supported?'O aplicativo está na versão mais recente disponível.':'Atualização indisponível neste ambiente.')}</p>}
   {state?.available&&<button type="button" className="update-primary" disabled={busy}
    onClick={()=>void install()}>{busy?'Preparando atualização…':'Baixar e instalar atualização'}</button>}
   {progress&&<p className="update-progress" role="status">{messageFor(progress)}</p>}
   {error&&<p role="alert" className="update-error">{error}</p>}
   {last&&<p className="update-footnote">Última instalação: {last.status==='success'?'Concluída':'Falhou'} — {last.message}</p>}
  </>}
 </section>;
}
