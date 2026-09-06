import { useState } from 'react';
import vibeRemoteLogo from '../assets/logo/vibeRemote_logo.svg';

function relativeTime(isoString) {
  if (!isoString) return 'Never seen';
  const diff  = Date.now() - new Date(isoString).getTime();
  const mins  = Math.floor(diff / 60_000);
  if (mins < 2)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 30)  return `${days}d ago`;
  return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''} ago`;
}

export default function MachineSelector({ machines, hostname, onReclaim, onNew, onDelete }) {
  const [loadingId,     setLoadingId]     = useState(null);
  const [error,         setError]         = useState('');
  const [localMachines, setLocalMachines] = useState(machines);

  async function reclaim(machine) {
    setError('');
    setLoadingId(machine.id);
    try {
      await onReclaim(machine.id, machine.label);
    } catch (err) {
      setError(err.message);
      setLoadingId(null);
    }
  }

  async function deleteMachine(machineId) {
    setError('');
    setLoadingId(machineId + '-del');
    try {
      await onDelete(machineId);
      setLocalMachines(prev => prev.filter(m => m.id !== machineId));
    } catch (err) {
      setError(err.message);
    }
    setLoadingId(null);
  }

  async function registerNew() {
    setError('');
    setLoadingId('new');
    try {
      await onNew();
    } catch (err) {
      setError(err.message);
      setLoadingId(null);
    }
  }

  return (
    <div className="selector-wrap">
      <div className="selector-card">
        <div className="selector-logo">
          <img src={vibeRemoteLogo} className="logo-icon" alt="" />
          <span className="logo-text">VibeRemote</span>
        </div>

        <h2 className="selector-title">Restore an existing machine</h2>
        <p className="selector-sub">
          Your account has registered machines. Pick one to restore its history,
          or start fresh with a new registration.
        </p>

        {error && <p className="msg-error" style={{ marginBottom: '16px' }}>{error}</p>}

        <div className="selector-list">
          {localMachines.map(m => {
            const isMatch = hostname && m.label === hostname;
            const isBusy  = loadingId === m.id || loadingId === m.id + '-del';

            return (
              <div key={m.id} className={`sel-row${isMatch ? ' sel-row-match' : ''}`}>
                <div className="sel-row-info">
                  <div className="sel-row-top">
                    <span className="sel-label">{m.label}</span>
                    {isMatch && <span className="sel-badge">this machine</span>}
                    <span className={`sel-status ${m.is_online ? 'sel-online' : 'sel-offline'}`}>
                      {m.is_online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <span className="sel-meta">Last seen {relativeTime(m.last_seen)}</span>
                </div>

                <div className="sel-row-actions">
                  <button
                    className="btn-reclaim"
                    onClick={() => reclaim(m)}
                    disabled={!!loadingId}
                  >
                    {loadingId === m.id ? 'Restoring…' : 'Restore'}
                  </button>
                  <button
                    className="btn-del"
                    onClick={() => deleteMachine(m.id)}
                    disabled={!!loadingId}
                    title="Remove this machine from your account"
                  >
                    {loadingId === m.id + '-del' ? '…' : 'Delete'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="sel-divider" />

        <button
          className="btn-ghost sel-new-btn"
          onClick={registerNew}
          disabled={!!loadingId}
        >
          {loadingId === 'new' ? 'Registering…' : '+ Register as new machine'}
        </button>
      </div>
    </div>
  );
}
