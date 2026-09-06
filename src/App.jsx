import Dashboard from './components/Dashboard.jsx';
import TitleBar from './components/TitleBar.jsx';

// Mobile-first auth: the desktop no longer logs in. It self-registers its machine
// and is controlled by pairing a phone (QR scan). The dashboard renders directly.
export default function App() {
  return (
    <div className="app-root">
      <TitleBar />
      <Dashboard />
    </div>
  );
}
