import {useEffect,useRef,useState} from 'react';
import './desktop-updates.css';
import type {Session} from './api-client.ts';

type Release={version:string;notes:string;size:number};
type State={supported:boolean;currentVersion:string;available:Release|null;message?:string};
type Progress={phase:string;bytes?:number;total?:number;message?:string;version?:string;backupCreated?:boolean};
type LastResult={status:string;message:string}|null;
type Bridge={
 info():Promise<{supported:boolean;currentVersion:string}>;
 check():Promise<State>;
 install():Promise<{started:boolean;cancelled?:boolean;backupCreated?:boolean}>;
 lastResult():Promise<LastResult>;
 onProgress(callback:(value:Progress)=>void):()=>void;
};
declare global{interface Window{lojaUpdates?:Bridge;lojaBackups?:{create(auth:{token:string;storeId:string}):Promise<{cancelled:boolean;bytes?:number;sha256?:string}>;
 verify(auth:{token:string;storeId:string}):Promise<{cancelled:boolean;verified?:boolean;sales?:number;photos?:number;migrations?:number}>}}}

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
function updateStage(progress:Progress|null){
 switch(progress?.phase){
  case 'preparing':return 'Preparando os arquivos';
  case 'download':return 'Baixando atualização';
  case 'verified':
  case 'checking-integrity':return 'Verificando arquivos';
  case 'backup':
  case 'backup-complete':return 'Protegendo seus dados';
  case 'installing':return 'Instalando nova versão';
  default:return 'Aguardando confirmação';
 }
}
function downloadPercentage(progress:Progress|null){
 if(progress?.phase!=='download'||!Number.isFinite(progress.bytes)||!Number.isFinite(progress.total)||
   !progress.total||progress.total<=0||Number(progress.bytes)<0)return null;
 return Math.max(0,Math.min(100,Math.round(Number(progress.bytes)*100/progress.total)));
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
  const unsubscribe=bridge.onProgress(value=>{
   if(!alive)return;
   setProgress(value);
   if(value.phase==='error'){
    setError(value.message||'Falha ao preparar a atualização.');
    setBusy(false);
   }
  });
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
  setBusy(true);setProgress(null);setError('');
  try{
   const result=await window.lojaUpdates.install();
   if(result.cancelled||!result.started)setBusy(false);
  }catch(err){
   setError(err instanceof Error?err.message:'Não foi possível preparar a atualização.');
   setBusy(false);
  }
 }
 if(!release||dismissed)return null;
 const percent=busy?downloadPercentage(progress):null;
 return <dialog ref={dialogRef} className="update-dialog" aria-label="Atualização da loja"
    onCancel={event=>{if(busy){event.preventDefault();return;}setDismissed(true);}}>
  <div className="update-dialog-content">
   <div className={`update-motion${busy?' is-running':''}${percent!==null?' is-measured':''}`}
    role={percent!==null?'progressbar':undefined}
    aria-label={percent!==null?'Download da atualização':undefined}
    aria-valuemin={percent!==null?0:undefined} aria-valuemax={percent!==null?100:undefined}
    aria-valuenow={percent??undefined}>
    <span className="update-motion-glow" aria-hidden="true"/>
    <span className="update-motion-orbit" aria-hidden="true"/>
    <span className="update-motion-ring" aria-hidden="true"
     style={percent!==null?{background:`conic-gradient(#b7a3ff ${percent}%, rgba(255,255,255,.12) 0)`}:undefined}/>
    <span className="update-motion-center" aria-hidden="true">
     {percent!==null?<strong className="update-motion-percent">{percent}%</strong>:
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round">
       <path d="M14 19h20l-2 19H16l-2-19Z"/>
       <path d="M19 20v-5a5 5 0 0 1 10 0v5"/>
       <path d="M19 27h10"/>
      </svg>}
    </span>
   </div>
   <p className="update-dialog-kicker">{busy?'ATUALIZAÇÃO EM ANDAMENTO':'ATUALIZAÇÃO DISPONÍVEL'}</p>
   <h2 id="update-dialog-title">{busy?'Atualizando sua loja':'Uma nova versão está pronta'}</h2>
   <p className="update-dialog-description">{busy
    ?'Estamos preparando tudo para você continuar de onde parou.'
    :<>Versão <strong>v{release.version}</strong> disponível para instalar.</>}</p>
   {busy?<div className="update-stage" role="status" aria-live="polite">
     <span className="update-stage-indicator" aria-hidden="true"/>
     <span>{updateStage(progress)}</span>
    </div>:
    <p className="update-confirmation-note">O download começa somente depois da sua confirmação.</p>}
   {error&&<div className="update-dialog-error" role="alert">
    <strong>Não foi possível concluir a atualização.</strong>
    <p>Você pode tentar novamente.</p>
    <details><summary>Detalhes do erro</summary><p>{error}</p></details>
   </div>}
  </div>
  <div className="update-dialog-actions">
   {busy?<p className="update-running-hint">Acompanhe o andamento por aqui.</p>:<>
    <button type="button" className="update-secondary" onClick={()=>setDismissed(true)}>Agora não</button>
    <button type="button" className="update-primary" onClick={()=>void install()}>Atualizar agora</button>
   </>}
  </div>
 </dialog>;
}
export function LocalBackupSettings({session}:{session:Session}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const bridge=window.lojaBackups;
 if(!bridge)return <section className="update-settings"><h2>Backup da loja</h2><p>Faça o backup no computador principal. Terminais de rede não possuem o banco de dados.</p></section>;
 return <section className="update-settings" aria-label="Backup local da loja">
  <h2>Exportar backup completo</h2>
  <p>Salve o arquivo PostgreSQL em unidade externa. Inclui produtos, fotos, vendas e histórico. Guarde uma cópia fora do computador principal.</p>
  <button className="update-primary" disabled={busy} onClick={()=>{setBusy(true);setError('');setNotice('');
   void bridge.create({token:session.token,storeId:session.storeId}).then(result=>{if(!result.cancelled)setNotice('Backup concluído e conferido · '+result.bytes+' bytes · SHA-256 '+result.sha256);})
    .catch(e=>setError(e instanceof Error?e.message:'Falha ao criar backup')).finally(()=>setBusy(false));
  }}>{busy?'Criando backup…':'Escolher destino e exportar backup'}</button>
  <button className="update-secondary" disabled={busy} onClick={()=>{setBusy(true);setNotice('');setError('');
   void bridge.verify({token:session.token,storeId:session.storeId}).then(result=>{if(!result.cancelled)setNotice('Restauração testada com sucesso em banco isolado: '+result.sales+' vendas, '+result.photos+' fotos. Nenhum dado atual foi substituído.');})
    .catch(e=>setError(e instanceof Error?e.message:'Falha ao validar restauração')).finally(()=>setBusy(false));
  }}>Verificar arquivo e testar restauração</button>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="update-error">{error}</p>}
 </section>;
}
export function UpdateSettings(){
 const [state,setState]=useState<State|null>(null);
 const [installedVersion,setInstalledVersion]=useState('');
 const [progress,setProgress]=useState<Progress|null>(null);
 const [last,setLast]=useState<LastResult>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{
  const bridge=window.lojaUpdates;
  if(!bridge)return;
  let alive=true;
  const unsubscribe=bridge.onProgress(value=>{if(alive)setProgress(value);});
  void bridge.info().then(info=>{if(alive)setInstalledVersion(info.currentVersion);}).catch(()=>{});
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
   <p className="update-footnote">Versão instalada: <strong>{(installedVersion||state?.currentVersion)?'v'+(installedVersion||state?.currentVersion):'indisponível'}</strong></p>
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
