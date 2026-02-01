import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import { AppProvider } from './context/AppContext';
import Dashboard from './pages/Dashboard';
import Provisioning from './pages/Provisioning';
import Settings from './pages/Settings';
import Templates from './pages/Templates';
import TerminalPage from './pages/TerminalPage';

import { ToastProvider } from './context/ToastContext';

function App() {
  return (
    <AppProvider>
      <ToastProvider>
      <Router>
      <div className="flex h-screen overflow-hidden bg-[#18181b] text-white font-sans">
        <Sidebar />
        <main className="flex-1 overflow-auto overscroll-contain">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/provisioning" element={<Provisioning />} />
            <Route path="/terminal" element={<TerminalPage />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
      </Router>
      </ToastProvider>
    </AppProvider>
  );
}

export default App;
