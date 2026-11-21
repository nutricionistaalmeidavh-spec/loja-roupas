'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {attachWindowHealth,normalizedFailure}=require('../src/window-health.cjs');

function fakeWindow(){
 const window=new EventEmitter();
 window.isDestroyed=()=>false;
 window.webContents=new EventEmitter();
 window.webContents.isDestroyed=()=>false;
 window.webContents.reloadIgnoringCache=()=>{window.reloads=(window.reloads||0)+1;};
 window.close=()=>{window.closed=true;};
 return window;
}
test('subresource and aborted navigations never show native error',async()=>{
 const window=fakeWindow();const reports=[];
 attachWindowHealth({window,notify:report=>reports.push(report)});
 window.webContents.emit('did-fail-load',{},-3,'aborted','http://127.0.0.1:3333/',true);
 window.webContents.emit('did-fail-load',{},-102,'connection refused','http://127.0.0.1:3333/assets/app.js',false);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(reports.length,0);
});
test('main-frame navigation failure produces actionable recovery rather than a blank screen',async()=>{
 const window=fakeWindow();const reports=[];
 attachWindowHealth({window,notify:report=>reports.push(report)});
 window.webContents.emit('did-fail-load',{},-102,'ERR_CONNECTION_REFUSED','http://127.0.0.1:3000/',true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(reports.length,1);
 assert.equal(reports[0].kind,'navigation');
 assert.equal(reports[0].code,-102);
 assert.equal(typeof reports[0].retry,'function');
 reports[0].retry();
 assert.equal(window.reloads,1);
});
test('renderer crash reports cause without deleting data or silent reload',async()=>{
 const window=fakeWindow();const reports=[];
 attachWindowHealth({window,notify:report=>reports.push(report)});
 window.webContents.emit('render-process-gone',{}, {reason:'crashed',exitCode:-1073741819});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(reports.map(x=>x.kind),['renderer']);
 assert.equal(window.reloads||0,0);
});
test('diagnostics never expose URLs, tokens or passwords',()=>{
 const result=normalizedFailure('navigation',-102,'http://127.0.0.1:3290/?token=supersecret');
 assert.equal(JSON.stringify(result).includes('supersecret'),false);
 assert.equal(JSON.stringify(result).includes('3290'),false);
 assert.equal(result.kind,'navigation');
});

test('normal window shutdown never triggers a crash dialog',async()=>{
 const window=fakeWindow();const reports=[];
 attachWindowHealth({window,notify:report=>reports.push(report)});
 window.webContents.emit('render-process-gone',{}, {reason:'clean-exit',exitCode:0});
 window.webContents.emit('render-process-gone',{}, {reason:'killed',exitCode:0});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(reports.length,0);
});
