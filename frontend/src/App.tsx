import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Provisioning from './pages/Provisioning';
import Settings from './pages/Settings';
import Templates from './pages/Templates';
import TerminalPage from './pages/TerminalPage';

function App() {
  return (
    <Router>
      <div className="flex h-screen bg-[#1e1e1e] text-white font-sans">
        <Sidebar />
        <main className="flex-1 overflow-auto">
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
  );
}

export default App;
