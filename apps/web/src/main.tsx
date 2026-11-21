import { createRoot } from 'react-dom/client';
import { Storefront } from './StoreOperations.tsx';
import { App } from './App.tsx';
import { UpdateStartupDialog } from './DesktopUpdates.tsx';
import { InterfaceErrorBoundary } from './InterfaceErrorBoundary.tsx';
import './styles.css';
import './tour.css';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento root ausente');
const storefront = /^\/vitrine\/([a-f0-9-]{36})\/?$/i.exec(window.location.pathname);
createRoot(root).render(<InterfaceErrorBoundary>{storefront ? <Storefront storeId={storefront[1]}/> : <><App/><UpdateStartupDialog/></>}</InterfaceErrorBoundary>);

if (import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/service-worker.js').catch(error => {
    console.warn('Instalação como aplicativo indisponível', error);
  });
}
