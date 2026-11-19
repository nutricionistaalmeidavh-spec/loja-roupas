import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';

export function BarcodeLabel({sku}:{sku:string}) {
  const svg = useRef<SVGSVGElement>(null);
  const [valid,setValid] = useState(false);
  useEffect(() => {
    if (!svg.current) return;
    try {
      JsBarcode(svg.current, sku, {format:'CODE128',height:42,margin:22,fontSize:12});
      setValid(true);
    } catch {
      setValid(false);
    }
  }, [sku]);

  function printLabel() {
    document.documentElement.dataset.printLabel = 'true';
    try {window.print();} finally {delete document.documentElement.dataset.printLabel;}
  }

  return <section className="editor-block">
    <h3>Etiqueta de SKU</h3>
    <div className="barcode-label" hidden={!valid}><svg role="img" aria-label={'Code 128 para '+sku} ref={svg}/></div>
    {valid ? <button type="button" className="light-button" onClick={printLabel}>Imprimir etiqueta</button>
      : <p>Este SKU não pode ser codificado em Code 128.</p>}
  </section>;
}
