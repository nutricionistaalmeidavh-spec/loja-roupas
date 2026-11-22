'use strict';
function validatePrinterSelection(request,availableNames){
 if(!request||typeof request.deviceName!=='string'||!Array.isArray(availableNames)||
    !availableNames.includes(request.deviceName))
  throw Error('Selecione uma impressora instalada no Windows.');
 if(request.paperMm!==58&&request.paperMm!==80)throw Error('Papel deve ser de 58 ou 80 mm.');
 return {deviceName:request.deviceName,paperMm:request.paperMm};
}
module.exports={validatePrinterSelection};
