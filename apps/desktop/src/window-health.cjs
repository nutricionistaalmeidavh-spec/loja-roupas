'use strict';

/**
 * Monitor native Electron failures without exposing renderer contents, URLs,
 * credentials, database connection strings, or business records.
 */
function normalizedFailure(kind, code, _unsafeDetails) {
 const types=new Set(['navigation','renderer','unresponsive','service','render']);
 return {
  kind:types.has(kind)?kind:'unknown',
  code:Number.isSafeInteger(code)?code:null
 };
}

function attachWindowHealth({window, notify, onDiagnostic=()=>{}, unresponsiveMs=8000}) {
 if(!window || !window.webContents || typeof notify!=='function')
  throw new TypeError('Janela e notificador são obrigatórios.');
 let busy=false, frozenTimer=null, disposed=false, closing=false;
 const report=(kind,code)=>{
  if(disposed||closing||busy||window.isDestroyed())return;
  busy=true;
  const data=normalizedFailure(kind,code);
  try{onDiagnostic(data);}catch{/* Do not block the recovery UI if logging fails. */}
  const retry=()=>{
   if(!window.isDestroyed() && !window.webContents.isDestroyed())
    window.webContents.reloadIgnoringCache();
  };
  Promise.resolve().then(()=>notify({...data,retry})).catch(()=>{}).finally(()=>{busy=false;});
 };
 const onLoadFailure=(_event,code,_description,_url,isMainFrame)=>{
  if(code===-3 || !isMainFrame)return;
  report('navigation',code);
 };
 const onRendererExit=(_event,details)=>{
  // Electron also emits this event while closing a healthy window.
  // A native modal during shutdown prevents the application from exiting.
  if(details?.reason==='clean-exit'||details?.reason==='killed')return;
  report('renderer',details?.exitCode);
 };
 const onUnresponsive=()=>{
  if(frozenTimer!==null)return;
  frozenTimer=setTimeout(()=>{
   frozenTimer=null;
   report('unresponsive',null);
  },unresponsiveMs);
  frozenTimer.unref?.();
 };
 const onResponsive=()=>{
  if(frozenTimer!==null){clearTimeout(frozenTimer);frozenTimer=null;}
 };
 const onClosing=()=>{closing=true;onResponsive();};
 const dispose=()=>{
  if(disposed)return;
  disposed=true;
  onResponsive();
  window.webContents.removeListener('did-fail-load',onLoadFailure);
  window.webContents.removeListener('render-process-gone',onRendererExit);
  window.removeListener('unresponsive',onUnresponsive);
  window.removeListener('responsive',onResponsive);
  window.removeListener('close',onClosing);
 };
 window.webContents.on('did-fail-load',onLoadFailure);
 window.webContents.on('render-process-gone',onRendererExit);
 window.on('unresponsive',onUnresponsive);
 window.on('responsive',onResponsive);
 window.on('close',onClosing);
 window.once('closed',dispose);
 return {dispose, report};
}
module.exports={attachWindowHealth,normalizedFailure};
