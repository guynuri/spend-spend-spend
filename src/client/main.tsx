import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/heebo';
import './styles.css';
import './i18n';
import { initTheme } from './theme';
import { App } from './app';

initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
