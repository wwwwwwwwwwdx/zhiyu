import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { applyThemeToDom, readTheme } from './app/theme';
import './app/theme.css';

// 主题在首帧前就挂到 <html> 上，避免先闪一下水墨配色再切成霓虹
applyThemeToDom(readTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
