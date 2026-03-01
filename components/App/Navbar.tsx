
import React from 'react';
import { Sport } from '../../types';
import { Menu, Search, Star, BookOpen } from 'lucide-react';

interface NavbarProps {
  selectedTab: Sport | 'HOME' | 'METHODOLOGY';
  favoriteLeagues: Set<Sport>;
  onTabChange: (tab: Sport | 'HOME' | 'METHODOLOGY') => void;
  onSearchClick: () => void;
  onMenuClick: () => void;
  followingContent?: React.ReactNode;
}

export const Navbar: React.FC<NavbarProps> = ({ 
  selectedTab, 
  favoriteLeagues, 
  onTabChange, 
  onSearchClick, 
  onMenuClick,
  followingContent,
}) => {
  const handleScrollTop = (e: React.MouseEvent) => {
      // Allow button clicks to propagate normally, but catch background clicks
      if ((e.target as HTMLElement).tagName !== 'BUTTON' && (e.target as HTMLElement).tagName !== 'SVG' && (e.target as HTMLElement).tagName !== 'PATH') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
      }
  };

  return (
    <nav 
        className="safe-area-header sticky top-0 z-50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800/60 transition-colors duration-300 cursor-pointer"
        onClick={handleScrollTop}
    >
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          
          {/* Logo */}
          <div 
            className="flex-shrink-0 flex items-center gap-2 cursor-pointer group"
            onClick={() => onTabChange('HOME')}
          >
            <div className="w-8 h-8 bg-gradient-to-tr from-slate-700 to-slate-900 rounded-lg flex items-center justify-center text-white font-bold font-display shadow-lg group-hover:shadow-slate-500/25 transition-all">
              P
            </div>
            <span className="font-bold text-xl font-display tracking-tight block">Probably</span>
          </div>

          {/* Desktop Tabs (Horizontal Scroll) */}
          <div className="hidden lg:flex flex-1 items-center gap-1 overflow-x-auto no-scrollbar mask-gradient px-4">
            <button
              onClick={(e) => { e.stopPropagation(); onTabChange('HOME'); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${selectedTab === 'HOME' ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              Home
            </button>
            {/* Favorites First */}
            {Array.from(favoriteLeagues).sort().map((sport) => (
              <button
                key={sport}
                onClick={(e) => { e.stopPropagation(); onTabChange(sport); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${selectedTab === sport ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <Star size={12} className="fill-current text-slate-500 dark:text-slate-400" />
                {sport}
              </button>
            ))}
            <div className="w-px h-4 bg-slate-300 dark:bg-slate-700 mx-2 shrink-0"></div>
            <button
              onClick={(e) => { e.stopPropagation(); onTabChange('METHODOLOGY'); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${selectedTab === 'METHODOLOGY' ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              Methodology
            </button>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2 sm:gap-4">
            <button 
              onClick={(e) => { e.stopPropagation(); onSearchClick(); }}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              title="Search (Cmd+K)"
            >
              <Search size={20} />
            </button>

            <button 
              className="p-2 -mr-2 text-slate-500 dark:text-slate-400"
              onClick={(e) => { e.stopPropagation(); onMenuClick(); }}
            >
              <Menu size={24} />
            </button>
          </div>
        </div>
        {followingContent}
      </div>
    </nav>
  );
};
