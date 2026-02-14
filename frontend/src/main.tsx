import axios from 'axios'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ThemeProvider } from './context/ThemeContext.tsx'
import './i18n'
import './index.css'

axios.defaults.baseURL = '/api';

const THEME_STORAGE_KEY = 'lyra.theme';

if (typeof document !== 'undefined') {
  let isDarkTheme = true; // default
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'auto') {
        isDarkTheme = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      if (stored === 'light') isDarkTheme = false;
      if (stored === 'dark') isDarkTheme = true;
    } catch {
      // Ignore storage read errors and keep default dark mode.
    }
  }
  document.documentElement.classList.toggle('theme-dark', isDarkTheme);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
