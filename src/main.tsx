import React from 'react';
import ReactDOM from 'react-dom/client';
import { isTauri } from '@tauri-apps/api/core';
import { App } from './app/App';
import { TauriGateway } from './platform/tauriGateway';
import { PreviewGateway } from './platform/previewGateway';
import './styles.css';

const gateway = isTauri() ? new TauriGateway() : new PreviewGateway();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App gateway={gateway} />
  </React.StrictMode>,
);
