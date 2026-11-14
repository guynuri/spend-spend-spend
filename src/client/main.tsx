import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { APP_NAME } from '../shared/app';

function App() {
  return <main data-testid="app-root" className="p-4 text-start">{APP_NAME}</main>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
