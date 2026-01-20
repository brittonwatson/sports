
import React, { useRef, useEffect } from 'react';
import { UserProfile } from '../../types';
import { X, User as UserIcon, LogOut, Monitor, Sun, Moon } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile | null;
  onLogout: () => void;
  theme: string;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  isDarkMode: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen, onClose, user, onLogout, theme, setTheme, isDarkMode
}) => {
  const googleButtonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && !user && googleButtonRef.current) {
      // @ts-ignore
      if (window.google) {
        // @ts-ignore
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: isDarkMode ? 'filled_black' : 'outline',
          size: 'large',
          width: '100%'
        });
      }
    }
  }, [isOpen, user, isDarkMode]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-950 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
          <h2 className="text-lg font-bold font-display text-slate-900 dark:text-white">Settings</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-8">
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <UserIcon size={14} /> Account
            </h3>
            {user ? (
              <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl flex items-center justify-between border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <img src={user.picture} alt="" className="w-10 h-10 rounded-full" />
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{user.name}</p>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </div>
                </div>
                <button onClick={onLogout} className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 p-2 rounded-lg transition-colors">
                  <LogOut size={18} />
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-600 dark:text-slate-400">Sign in to sync your favorite teams and leagues across devices.</p>
                <div ref={googleButtonRef} className="w-full h-[40px]"></div>
              </div>
            )}
          </div>
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Monitor size={14} /> Appearance
            </h3>
            <div className="grid grid-cols-3 gap-2 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800">
              {(['light', 'system', 'dark'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setTheme(m)}
                  className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold capitalize transition-all ${theme === m ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  {m === 'light' ? <Sun size={14} /> : m === 'dark' ? <Moon size={14} /> : <Monitor size={14} />}
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
