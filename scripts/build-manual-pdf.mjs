// Gera docs/comercial/Manual-Loja-de-Roupas.pdf a partir do HTML do manual.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const source=path.resolve('docs/comercial/manual/manual.html');
const output=path.resolve('docs/comercial/Manual-Loja-de-Roupas.pdf');
const browser=await chromium.launch();
try{
 const page=await browser.newPage();
 await page.goto(pathToFileURL(source).href);
 await page.pdf({path:output,format:'A4',printBackground:true,displayHeaderFooter:true,
  headerTemplate:'<span></span>',
  footerTemplate:'<div style="font-size:8px;width:100%;text-align:center;color:#888">Loja de Roupas ArtiSys · página <span class="pageNumber"></span> de <span class="totalPages"></span></div>',
  margin:{top:'18mm',bottom:'18mm',left:'16mm',right:'16mm'}});
 console.info(output);
}finally{await browser.close();}
