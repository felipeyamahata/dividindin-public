import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.jsx';
import { ConfirmDialog } from './components/ConfirmDialog.jsx';
import { initPwaInstall } from './lib/installPrompt.js';
import './index.css';
import './components/LoginPage.css';
import './motion.css';
import './components/ExpenseForm.css';
import './components/AppSurfaces.css';

initPwaInstall(import.meta.env.BASE_URL);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <div className="app-background login-page__photo" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map(slide => <div key={slide} className={`login-page__slide login-page__slide--${slide + 1}`} />)}
    </div>
    <div className="app-foreground"><App /><ConfirmDialog /></div>
  </React.StrictMode>
);
