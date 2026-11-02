import React from 'react';
import ReactDOM from 'react-dom/client';
import { PlantProvider } from './context/PlantContext';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PlantProvider>
      <App />
    </PlantProvider>
  </React.StrictMode>,
);
