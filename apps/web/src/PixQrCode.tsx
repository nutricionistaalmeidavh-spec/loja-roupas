import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { headers, jsonRequest } from './api-client.ts';
import type { Session } from './api-client.ts';
import { buildPixPayload } from './pix-brcode.ts';

type PixProfile = { name: string; pix_key?: string | null; pix_city?: string | null; address?: string | null };
const cache = new Map<string, Promise<PixProfile>>();
function loadProfile(session: Session) {
  const key = session.storeId;
  if (!cache.has(key)) {
    const request = jsonRequest<PixProfile>('/v1/management/store-profile', { headers: headers(session) }, fetch);
    request.catch(() => cache.delete(key));
    cache.set(key, request);
  }
  return cache.get(key)!;
}
/** Esquece a chave guardada (depois de salvar os dados da loja). */
export function forgetPixProfile() { cache.clear(); }

/** QR Code do Pix com o valor do pagamento, para a cliente ler no celular. */
export function PixQrCode({ session, amountCents, reference }: { session: Session; amountCents: number; reference?: string }) {
  const [profile, setProfile] = useState<PixProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    loadProfile(session).then(p => { if (alive) setProfile(p); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [session]);
  const payload = useMemo(() => {
    if (!profile?.pix_key || amountCents <= 0) return '';
    try { return buildPixPayload({ key: profile.pix_key, name: profile.name, city: profile.pix_city ?? '', amountCents, txid: reference }); }
    catch { return ''; }
  }, [profile, amountCents, reference]);
  const svg = useMemo(() => {
    if (!payload) return '';
    const qr = qrcode(0, 'M');
    qr.addData(payload);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [payload]);
  if (failed) return null;
  if (!profile) return null;
  if (!profile.pix_key) return <p className="muted small">Para mostrar o QR Code do Pix, cadastre a chave Pix em Gestão › Pessoas e loja.</p>;
  if (!payload) return null;
  return <div className="pix-qr" role="group" aria-label="QR Code do Pix">
    <div className="pix-qr-image" role="img" aria-label={'QR Code Pix de ' + (amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
      dangerouslySetInnerHTML={{ __html: svg }} />
    <div className="pix-qr-copy">
      <p className="small">Peça para a cliente ler o QR Code no aplicativo do banco. Depois confira o recebimento antes de confirmar.</p>
      <button type="button" className="light-button" onClick={() => {
        void navigator.clipboard?.writeText(payload).then(() => setCopied(true)).catch(() => setCopied(false));
      }}>{copied ? 'Código copiado' : 'Copiar Pix copia e cola'}</button>
    </div>
  </div>;
}
