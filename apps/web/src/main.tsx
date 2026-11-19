import { createRoot } from 'react-dom/client';
import { Storefront } from './StoreOperations.tsx';
import { App } from './App.tsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento root ausente');
const storefront = /^\/vitrine\/([a-f0-9-]{36})\/?$/i.exec(window.location.pathname);
createRoot(root).render(storefront ? <Storefront storeId={storefront[1]}/> : <App />);
