import { useState, useEffect } from 'react';

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    window.windowControls.isMaximized().then(setMaximized);
    window.windowControls.onMaximizeChange(setMaximized);
  }, []);

  return (
    <div className="titlebar">
      <div className="titlebar-drag" />
      <div className="titlebar-buttons">
        <button
          className="tb-btn tb-minimize"
          onClick={() => window.windowControls.minimize()}
          title="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="tb-btn tb-maximize"
          onClick={() => window.windowControls.maximize()}
          title={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path
                d="M3 0H10V7H7V10H0V3H3V0ZM3 3H1V9H6V7H3V3ZM4 1V6H9V1H4Z"
                fill="currentColor"
              />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path
                d="M0 0H10V10H0V0ZM1 2V9H9V2H1Z"
                fill="currentColor"
              />
            </svg>
          )}
        </button>
        <button
          className="tb-btn tb-close"
          onClick={() => window.windowControls.close()}
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path
              d="M1 0L5 4L9 0L10 1L6 5L10 9L9 10L5 6L1 10L0 9L4 5L0 1L1 0Z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
