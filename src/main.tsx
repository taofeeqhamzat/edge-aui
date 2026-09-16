import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './style.css';
import { EdgeAUIFramework } from './core/pipeline.js';

const root = createRoot(document.getElementById('app')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Initialize Framework Orchestrator
const framework = new EdgeAUIFramework({
  bufferWindowMs: 500,
  trackableSelector: '[data-trackable]',
  hesitationConfidenceThreshold: 0.35
});

framework.init().then(() => {
  framework.start();
  console.log('[Edge-AUI] Framework running with dual-gate inference.');
});
