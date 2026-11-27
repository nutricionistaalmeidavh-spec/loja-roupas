const test=require('node:test'),assert=require('node:assert/strict');
const {validatePrinterSelection}=require('../src/native-print.cjs');

test('impressão silenciosa só permite impressora reconhecida e papel 58/80 ou A4 meia folha',()=>{
 const names=['Caixa - Epson','PDF'];
 assert.deepEqual(validatePrinterSelection({deviceName:'Caixa - Epson',paperMm:80},names),
  {deviceName:'Caixa - Epson',paperMm:80});
 assert.throws(()=>validatePrinterSelection({deviceName:'Desconhecida',paperMm:80},names));
 assert.throws(()=>validatePrinterSelection({deviceName:'PDF',paperMm:100},names));
 assert.deepEqual(validatePrinterSelection({deviceName:'PDF',paperMm:210},names),{deviceName:'PDF',paperMm:210});
});
