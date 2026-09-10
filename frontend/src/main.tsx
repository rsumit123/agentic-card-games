import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tokens.css';
import './styles/base.css';
import App from './App';
import { config } from './config';

async function bootstrap() {
  if (config.mockApi) {
    const { worker, installMockWebSocket } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
    installMockWebSocket();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter><App /></BrowserRouter>
    </StrictMode>,
  );
}

void bootstrap();
