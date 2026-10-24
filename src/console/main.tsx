import { startUiLocale } from '../shared/ui-locale.js';
import '../site/appearance.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './studio.css';
import { startLiquidGlass } from '../shared/liquid-glass.js';
import { startFormControls } from '../shared/forms.js';
startLiquidGlass();
startFormControls();
await startUiLocale('studio', async (locale) => locale === 'zh-Hans' ? (await import('../locales/zh-Hans.studio.json')).default : (await import('../locales/zh-Hant.studio.json')).default);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
