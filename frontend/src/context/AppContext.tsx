/* eslint-disable react-refresh/only-export-components */
import axios from 'axios';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';

interface AppContextType {
  appName: string;
  setAppName: (name: string) => void;
  isLoading: boolean;
  refreshSettings: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [appName, setAppNameState] = useState('Lyra');
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = async () => {
    try {
      setIsLoading(true);
      const res = await axios.get('/settings/app_name');
      if (res.data && res.data.value) {
        setAppNameState(res.data.value);
      }
    } catch (error) {
      console.error("Failed to fetch app name setting", error);
    } finally {
      setIsLoading(false);
    }
  };

  const setAppName = async (newName: string) => {
    try {
      await axios.put('/settings/app_name', { value: newName });
      setAppNameState(newName);
    } catch (error) {
      console.error("Failed to update app name", error);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  return (
    <AppContext.Provider value={{ appName, setAppName, isLoading, refreshSettings: fetchSettings }}>
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
