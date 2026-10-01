/// <reference types="vite-plugin-pwa/client" />
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { store } from './storage/store';
import { demoActions, demoConfig } from './demo';
import './styles.css';

if (new URLSearchParams(location.search).has('demo')) void store.startDemo(demoConfig, demoActions());
else { void store.boot(); registerSW({ immediate: true }); }

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
