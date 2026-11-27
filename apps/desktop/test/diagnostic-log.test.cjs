'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createLog,exportDiagnostic,redact,dayFile}=require('../src/diagnostic-log.cjs');

test('log não guarda senha, banco, token, e-mail nem documento',()=>{
 const out=redact('DATABASE_URL=postgresql://loja:s3nh4@127.0.0.1:5432/loja authorization: Bearer abcDEF123 password=xyz cliente ana@ex.com cpf 123.456.789-09 cnpj 12.345.678/0001-95 fone (11) 98765-4321');
 for(const leaked of ['s3nh4','abcDEF123','xyz','ana@ex.com','123.456.789-09','12.345.678/0001-95','98765-4321'])assert.ok(!out.includes(leaked),leaked+' vazou: '+out);
});

test('log grava por dia, apaga os antigos e exporta diagnóstico',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'loja-log-'));
 for(let i=0;i<20;i++)fs.writeFileSync(path.join(dir,'loja-2026-01-'+String(i+1).padStart(2,'0')+'.log'),'antigo\n');
 const log=createLog(dir);
 assert.equal(fs.readdirSync(dir).length,14);
 log.info('API iniciada na porta 3000');
 log.error(new Error('falhou com senha=abc'));
 const today=fs.readFileSync(dayFile(dir),'utf8');
 assert.match(today,/\[app\] API iniciada/);
 assert.doesNotMatch(today,/senha=abc/);
 const destination=path.join(dir,'diagnostico.txt');
 await exportDiagnostic({dir,destination,appVersion:'9.9.9',extra:{'Modo':'Computador principal'}});
 const text=fs.readFileSync(destination,'utf8');
 assert.match(text,/Versão do aplicativo: 9\.9\.9/);
 assert.match(text,/API iniciada/);
 fs.rmSync(dir,{recursive:true,force:true});
});
