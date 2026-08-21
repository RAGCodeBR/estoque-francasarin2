import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { App } from './App';
import './styles/global.css';

const rootElement = document.querySelector<HTMLElement>('#root');

if (!rootElement) {
  throw new Error('Elemento raiz da aplicação não encontrado.');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
