import React, { useState } from 'react';
import { Hammer, RefreshCw } from 'lucide-react';

export function MaintenanceScreen({ onRetry }) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setTimeout(() => setRetrying(false), 500);
    }
  };

  return <main className="app-status"><section className="app-status__card">
    <Hammer size={32} aria-hidden="true" />
    <h1>estamos em manutenção</h1>
    <p>não foi possível conectar. tente novamente em alguns instantes.</p>
    <button className="app-dialog__primary" onClick={handleRetry} disabled={retrying}><RefreshCw size={17} />{retrying ? 'verificando conexão...' : 'tentar novamente'}</button>
  </section></main>;
}
