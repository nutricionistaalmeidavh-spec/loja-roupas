'use strict';
function validatePrinterSelection(request,availableNames){
 if(!request||typeof request.deviceName!=='string'||!Array.isArray(availableNames)||
    !availableNames.includes(request.deviceName))
  throw Error('Selecione uma impressora instalada no Windows.');
 if(![58,80,210].includes(request.paperMm))throw Error('Papel deve ser bobina de 58 ou 80 mm, ou A4 meia folha.');
 return {deviceName:request.deviceName,paperMm:request.paperMm};
}
module.exports={validatePrinterSelection};
