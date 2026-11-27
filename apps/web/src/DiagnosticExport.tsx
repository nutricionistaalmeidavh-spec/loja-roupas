import { useState } from 'react';

declare global { interface Window { lojaDiagnostics?: { export(): Promise<{ saved: boolean }> } } }

/** Salva um arquivo de diagnóstico (sem senhas nem dados de clientes) para mandar ao suporte. */
export function DiagnosticExport() {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  if (!window.lojaDiagnostics) return null;
  return <section className="management-section" aria-label="Diagnóstico para o suporte">
    <h2>Diagnóstico para o suporte</h2>
    <p>Se algo der errado, salve este arquivo e mande para o suporte. Ele traz o registro dos últimos dias do aplicativo, sem senhas, chaves ou dados de clientes.</p>
    <button type="button" className="light-button" disabled={busy} onClick={() => {
      setBusy(true); setNotice(''); setError('');
      void window.lojaDiagnostics!.export().then(r => { if (r.saved) setNotice('Diagnóstico salvo. Envie o arquivo para o suporte.'); })
        .catch(e => setError(e instanceof Error ? e.message : 'Não foi possível salvar o diagnóstico.')).finally(() => setBusy(false));
    }}>{busy ? 'Salvando…' : 'Exportar diagnóstico'}</button>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="error">{error}</p>}
  </section>;
}
