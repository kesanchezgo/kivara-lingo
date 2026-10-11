import React from 'react';
import { createRoot } from 'react-dom/client';
import { Popup } from './Popup';
import '../styles/globals.css';
import '../styles/theme.css';
import '../styles/tailwind.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);
