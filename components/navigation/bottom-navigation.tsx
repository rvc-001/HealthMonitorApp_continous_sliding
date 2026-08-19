'use client';

import { Video, History, Brain, Settings, Database } from 'lucide-react';

interface BottomNavigationProps {
  activeTab: string;
  setActiveTab: (tab: any) => void;
}

export default function BottomNavigation({ activeTab, setActiveTab }: BottomNavigationProps) {
  const navItems = [
    {
      id: 'recording',
      label: 'Record',
      icon: Video,
    },
    {
      id: 'data',
      label: 'Data',
      icon: Database,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-card border-t border-border flex items-center justify-around h-20 px-2 safe-area-inset-bottom">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;

        return (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`flex flex-col items-center justify-center gap-1 px-4 py-3 rounded-md transition-colors duration-200 flex-1 ${
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon className="w-6 h-6" strokeWidth={2} />
            <span className="text-xs font-medium">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
