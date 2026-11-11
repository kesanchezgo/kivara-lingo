import React from 'react';
import { createRoot } from 'react-dom/client';
import { Popup } from './Popup';
import '../styles/globals.css';
import '../styles/theme.css';
import '../styles/tailwind.css';
import { ensureKivaraInter } from '../ui/fonts';

// Register the bundled Inter before the first paint; the system
// stack is the fallback while it loads.
void ensureKivaraInter();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);
