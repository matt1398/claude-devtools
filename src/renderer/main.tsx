import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';

// Log renderer errors to the main process crash log for post-mortem diagnostics.
// Uses console.error which is forwarded by the main process 'console-message' handler.
window.addEventListener('error', (event) => {
  console.error(
    `[RENDERER_UNCAUGHT_ERROR] ${event.message} at ${event.filename}:${event.lineno}`
  );
});
window.addEventListener('unhandledrejection', (event) => {
  const reason =
    event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
  console.error(`[RENDERER_UNHANDLED_REJECTION] ${reason}`);
});

import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
