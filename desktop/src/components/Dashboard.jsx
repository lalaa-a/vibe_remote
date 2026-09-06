import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, API_URL } from '../lib/supabase.js';
import vibeRemoteLogo from '../assets/logo/vibeRemote_logo.svg';
import phoneIcon from '../assets/icons/smartphone.svg';
import claudeCodeLogo from '../assets/harnessLogos/claudecode.svg';
import openCodeLogo from '../assets/harnessLogos/opencode.svg';

// Real brand logos; harnesses without a logo file fall back to the inline glyph below.
const HARNESS_LOGO = {
  'claude-code': claudeCodeLogo,
  'opencode':    openCodeLogo,
};

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// All desktop↔server calls now authenticate with the machine API key — there is no
// user login on the desktop anymore (mobile-first auth). Identity arrives by pairing.
function machineHeaders(apiKey) {
  return { 'Content-Type': 'application/json', 'x-machine-api-key': apiKey };
}

function LogoMark() {
  return <img src={vibeRemoteLogo} width="26" height="26" alt="" />;
}

// Paired-device glyph — same stroke style as HarnessGlyph.
function PhoneGlyph() {
  return <img src={phoneIcon} width="26" height="26" style={{ filter: 'brightness(0) invert(1)' }} alt="" />;
}

// Per-harness glyph. Real brand logos for known harnesses; a dark inline glyph otherwise.
function HarnessGlyph({ harness }) {
  const logo = HARNESS_LOGO[harness];
  if (logo) return <img src={logo} width="22" height="22" alt="" />;
  const p = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (harness === 'gemini-cli') return (
    <svg {...p}><path d="M9 7l5 5-5 5" /></svg>
  );
  return <svg {...p}><circle cx="12" cy="12" r="6" /></svg>;
}

export default function Dashboard() {
  const [machineConfig, setMachineConfig] = useState(null);
  const [harnesses,     setHarnesses]     = useState([]);
  const [busyHarness,   setBusyHarness]   = useState(null);
  const [setupLoading,  setSetupLoading]  = useState(true);
  const [copied,        setCopied]        = useState(false);
  const [error,         setError]         = useState('');
  // Pairing: null = loading, { paired: false } = show QR, { paired: true, device, paired_at } = device card
  const [pairing,   setPairing]   = useState(null);
  // One-time QR nonce { challenge, expiresAt } — refreshed before it expires while unpaired
  const [challenge, setChallenge] = useState(null);

  const pairingRef    = useRef(null);
  const challengeRef  = useRef(null);
  const pollTimer     = useRef(null);
  const lastTokenRef  = useRef(null);

  useEffect(() => { initMachine(); }, []);

  // ── Pairing state: realtime push (instant) + a slow poll as a backstop ────────
  // The server broadcasts `paired`/`unpaired` on channel `machine:<id>` the moment
  // it happens — the desktop reacts immediately. The poll (10s unpaired / 120s
  // paired) only guarantees eventual correctness if a realtime event is missed.
  useEffect(() => {
    if (!machineConfig?.machineId) return;
    let stopped = false;

    async function ensureChallenge() {
      // Reuse the current nonce until it is within 30s of expiry, then mint a new one.
      const cur = challengeRef.current;
      const fresh = cur && (new Date(cur.expiresAt).getTime() - Date.now()) > 30_000;
      if (fresh) return;
      try {
        const res = await fetch(`${API_URL}/machines/${machineConfig.machineId}/challenge`, {
          method: 'POST',
          headers: machineHeaders(machineConfig.machineApiKey),
        });
        if (res.ok) {
          const data = await res.json();
          challengeRef.current = data;
          setChallenge(data);
        }
      } catch (e) {
        console.warn('[challenge]', e.message);
      }
    }

    async function loadPairing() {
      try {
        const res = await fetch(`${API_URL}/machines/${machineConfig.machineId}/session`, {
          headers: machineHeaders(machineConfig.machineApiKey),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.paired) {
            // Persist the session token to machine.env once (revoked on unpair).
            if (data.sessionToken && data.sessionToken !== lastTokenRef.current) {
              lastTokenRef.current = data.sessionToken;
              window.relay.writeMachineConfig({ MACHINE_SESSION_TOKEN: data.sessionToken });
            }
            const next = { paired: true, device: data.pairedDevice, paired_at: data.pairedAt };
            setPairing(next); pairingRef.current = next;
          } else {
            await ensureChallenge();
            const next = { paired: false };
            setPairing(next); pairingRef.current = next;
            lastTokenRef.current = null;
          }
        } else {
          const body = await res.json().catch(() => ({}));
          console.warn('[pairing poll] server error', res.status, body);
          await ensureChallenge();
          const fallback = { paired: false, _error: `${res.status}: ${body.error || 'server error'}` };
          setPairing(fallback); pairingRef.current = fallback;
        }
      } catch (e) {
        console.warn('[pairing poll]', e.message);
        const fallback = { paired: false, _error: e.message };
        setPairing(fallback); pairingRef.current = fallback;
      }
    }

    async function tick() {
      if (stopped) return;
      await loadPairing();
      if (stopped) return;
      // Backstop intervals — realtime carries the instant updates below.
      const delay = pairingRef.current?.paired ? 120_000 : 10_000;
      pollTimer.current = setTimeout(tick, delay);
    }

    // Realtime: any pair/unpair event → re-fetch /session right away (reuses the
    // same machine-key authed load, so no sensitive data rides the channel).
    const channel = supabase
      .channel(`machine:${machineConfig.machineId}`)
      .on('broadcast', { event: 'paired' },   () => { if (!stopped) loadPairing(); })
      .on('broadcast', { event: 'unpaired' }, () => { if (!stopped) loadPairing(); })
      .subscribe();

    tick();
    return () => {
      stopped = true;
      clearTimeout(pollTimer.current);
      supabase.removeChannel(channel);
    };
  }, [machineConfig?.machineId]);

  async function initMachine() {
    setSetupLoading(true);
    try {
      // Already configured — use the stored identity.
      const config = await window.relay.getMachineConfig();
      if (config?.machineId) {
        setMachineConfig(config);
        await loadHarnesses();
        setSetupLoading(false);
        return;
      }
      // First run — self-register this machine (no login required).
      await registerMachine();
    } catch (err) {
      setError(err.message);
    }
    setSetupLoading(false);
  }

  function makeRawKey() {
    return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  }

  async function registerMachine() {
    const machineId    = crypto.randomUUID();
    const rawKey       = makeRawKey();
    const apiKeyHash   = await sha256hex(rawKey);
    const machineLabel = await window.relay.getHostname();

    const res = await fetch(`${API_URL}/machines/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ machineId, machineLabel, apiKeyHash }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Registration failed (${res.status})`);
    }

    await window.relay.writeMachineConfig({
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      API_URL,
      MACHINE_ID:      machineId,
      MACHINE_LABEL:   machineLabel,
      MACHINE_API_KEY: rawKey,
      TIMEOUT_SECONDS: '300',
      FAIL_OPEN:       'true',
      ALWAYS_ALLOW:    'node_modules,\\.git/,dist/,\\.next/',
      ALWAYS_BLOCK:    '',
    });
    setMachineConfig({ machineId, machineLabel, machineApiKey: rawKey, supabaseUrl: SUPABASE_URL });
    await loadHarnesses();
  }

  async function handleUnpair() {
    try {
      await fetch(`${API_URL}/machines/${machineConfig.machineId}/pair`, {
        method:  'DELETE',
        headers: machineHeaders(machineConfig.machineApiKey),
      });
    } catch (e) {
      console.warn('[unpair]', e.message);
    }
    // Flip to QR immediately and restart the fast poll so a fresh challenge is minted.
    lastTokenRef.current = null;
    const unpaired = { paired: false };
    setPairing(unpaired); pairingRef.current = unpaired;
    clearTimeout(pollTimer.current);
    // Nudge the poll effect to re-run by re-setting the same config reference.
    setMachineConfig(c => ({ ...c }));
  }

  async function loadHarnesses() {
    try { setHarnesses(await window.harness.list()); }
    catch (err) { setError(err.message); }
  }

  async function toggleHarness(h) {
    setBusyHarness(h.harness);
    try {
      const enabled = await window.harness.setMobile(h.harness, !h.mobile_enabled);
      setHarnesses(list => list.map(x => (x.harness === h.harness ? { ...x, mobile_enabled: enabled } : x)));
    } catch (err) { setError(err.message); }
    setBusyHarness(null);
  }

  function copyMachineId() {
    if (!machineConfig?.machineId) return;
    navigator.clipboard.writeText(machineConfig.machineId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const qrData = machineConfig && challenge
    ? JSON.stringify({
        machineId:   machineConfig.machineId,
        apiKey:      machineConfig.machineApiKey,
        challenge:   challenge.challenge,
        supabaseUrl: machineConfig.supabaseUrl || SUPABASE_URL,
        apiUrl:      API_URL,
      })
    : '';

  // ── Render ────────────────────────────────────────────────────────────────────

  if (setupLoading) {
    return (
      <div className="splash">
        <div className="spinner" />
        <p className="setup-label">Setting up…</p>
      </div>
    );
  }

  const installed = harnesses.filter(h => h.installed);

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="header-logo">
          <span className="logo-mark"><LogoMark /></span>
          <span className="logo-text">vibeRemote</span>
        </div>
      </header>

      <main className="dash-main">
        {error && <div className="banner-error">{error}</div>}

        {/* ── Machine ── */}
        <section className="card">
          <h2 className="card-title">Machine</h2>
          <div className="kv-row">
            <span className="kv-key">Label</span>
            <span className="kv-val">{machineConfig?.machineLabel || '—'}</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">Machine ID</span>
            <span className="kv-val mono">
              <span className="mono-text">{machineConfig?.machineId || '—'}</span>
              <button className="btn-copy-sm" onClick={copyMachineId}>{copied ? '✓' : 'Copy'}</button>
            </span>
          </div>
        </section>

        {/* ── Mobile Connection ── */}
        <section className="card">
          <h2 className="card-title">Mobile Connection</h2>
          {pairing === null && <p className="card-sub">Loading pairing state…</p>}

          {pairing && !pairing.paired && (
            <>
              {pairing._error && (
                <p className="card-sub" style={{ color: 'var(--error)' }}>Pairing check failed Network Error — {pairing._error}</p>
              )}
              <p className="card-sub">Scan this QR code with the VibeRemote app to connect your phone.</p>
              <div className="qr-wrap">
                {qrData ? (
                  <div className="qr-box">
                    <QRCodeSVG value={qrData} size={150} bgColor="#ffffff" fgColor="#082134" level="M" />
                  </div>
                ) : (
                  <div className="qr-placeholder">Preparing QR…</div>
                )}
              </div>
            </>
          )}

          {pairing && pairing.paired && (
            <div className="paired-device">
              <div className="paired-info">
                <span className="paired-icon"><PhoneGlyph /></span>
                <div>
                  <p className="paired-name">{pairing.device?.device_name ?? 'Phone'}</p>
                  <p className="paired-meta">
                    <span className="status-dot on" style={{ display: 'inline-block', marginRight: 6 }} />
                    Connected
                    {pairing.paired_at ? ' · ' + new Date(pairing.paired_at).toLocaleDateString() : ''}
                  </p>
                </div>
              </div>
              <button className="btn-ghost btn-danger" onClick={handleUnpair}>Unpair</button>
            </div>
          )}
        </section>

        {/* ── Harness Support ── */}
        <section className="card">
          <h2 className="card-title">Harness Support</h2>

          {installed.length === 0 && (
            <p className="hook-hint" style={{ marginLeft: 0 }}>
              No supported agent CLI detected on this machine. Install Claude Code, OpenCode,
              or Gemini CLI, then reopen this app.
            </p>
          )}

          {installed.map(h => (
            <div key={h.harness} className="harness-row">
              <div className="toggle-row">
                <div className="toggle-info">
                  <span className="harness-bubble"><HarnessGlyph harness={h.harness} /></span>
                  <span className="harness-name">
                    {h.displayName}
                    {h.version ? <span className="harness-ver"> · {h.version}</span> : null}
                  </span>
                </div>
                <button
                  className={`toggle-btn ${h.mobile_enabled ? 'toggle-on' : 'toggle-off'}`}
                  onClick={() => toggleHarness(h)}
                  disabled={busyHarness === h.harness}
                >
                  <span className="toggle-thumb" />
                </button>
              </div>
              {h.capabilities?.approvalMechanism === 'pty-proxy' && (
                <p className="hook-hint">
                  Approvals for {h.displayName} are pattern-based (terminal proxy) — verify on screen.
                  Launch it via <code>vibe run {h.harness}</code>.
                </p>
              )}
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
