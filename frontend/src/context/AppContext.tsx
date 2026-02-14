/* eslint-disable react-refresh/only-export-components */
import axios from 'axios';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

interface AppContextType {
  appName: string;
  setAppName: (name: string) => Promise<void>;
  faviconDataUrl: string;
  setFavicon: (dataUrl: string) => Promise<void>;
  isLoading: boolean;
  refreshSettings: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [appName, setAppNameState] = useState('Lyra');
  const [faviconDataUrl, setFaviconDataUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const applyFavicon = useCallback((url: string) => {
    const fallback = '/favicon.ico';
    const target = url || fallback;
    let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = target;
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const [nameRes, faviconRes] = await Promise.allSettled([
        axios.get('settings/app_name'),
        axios.get('settings/favicon_data_url'),
      ]);

      if (nameRes.status === 'fulfilled' && nameRes.value.data?.value) {
        setAppNameState(nameRes.value.data.value);
      }

      const nextFavicon =
        faviconRes.status === 'fulfilled' && faviconRes.value.data?.value
          ? String(faviconRes.value.data.value)
          : '';

      setFaviconDataUrl(nextFavicon);
      applyFavicon(nextFavicon);
    } catch (error) {
      console.error("Failed to fetch app settings", error);
      applyFavicon('');
    } finally {
      setIsLoading(false);
    }
  }, [applyFavicon]);

  const setAppName = async (newName: string) => {
    await axios.put('settings/app_name', { value: newName });
    setAppNameState(newName);
  };

  const setFavicon = async (dataUrl: string) => {
    await axios.put('settings/favicon_data_url', { value: dataUrl });
    setFaviconDataUrl(dataUrl);
    applyFavicon(dataUrl);
  };

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (!faviconDataUrl) {
      applyFavicon('');
      return;
    }
    applyFavicon(faviconDataUrl);
  }, [faviconDataUrl, applyFavicon]);

  return (
    <AppContext.Provider value={{ appName, setAppName, faviconDataUrl, setFavicon, isLoading, refreshSettings: fetchSettings }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
