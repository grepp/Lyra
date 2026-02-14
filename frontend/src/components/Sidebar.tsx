import clsx from 'clsx';
import { FileCode, LayoutDashboard, PlusCircle, Settings, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';

const navItems = [
  { nameKey: 'nav.dashboard', path: '/', icon: LayoutDashboard },
  { nameKey: 'nav.provisioning', path: '/provisioning', icon: PlusCircle },
  { nameKey: 'nav.terminal', path: '/terminal', icon: Terminal },
  { nameKey: 'nav.templates', path: '/templates', icon: FileCode },
  { nameKey: 'nav.settings', path: '/settings', icon: Settings },
];

export default function Sidebar() {
  const location = useLocation();
  const { appName } = useApp();
  const { t } = useTranslation();

  return (
    <div className="w-64 bg-[var(--bg-elevated)] border-r border-[var(--border)] flex flex-col">
      <div className="p-6">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          {appName}
        </h1>
      </div>
      <nav className="flex-1 px-4 space-y-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={clsx(
                "flex items-center px-4 py-3 rounded-lg transition-all duration-200 group",
                isActive
                  ? "bg-[color-mix(in_oklab,var(--primary)_14%,transparent)] text-[var(--primary)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--text)]"
              )}
            >
              <item.icon size={20} className={clsx("mr-3", isActive ? "text-[var(--primary)]" : "text-[var(--text-muted)] group-hover:text-[var(--text)]")} />
              <span className="font-medium">{t(item.nameKey)}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-[var(--border)]">
        <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
           <div className="w-2 h-2 rounded-full bg-green-500"></div>
           {t('system.status')}: {t('system.online')}
        </div>
      </div>
    </div>
  );
}
