import React from 'react';
import { GroundingChunk } from '../types';
import { ExternalLink } from 'lucide-react';

interface GroundingSourcesProps {
  chunks: GroundingChunk[];
}

export const GroundingSources: React.FC<GroundingSourcesProps> = ({ chunks }) => {
  if (!chunks || chunks.length === 0) return null;

  // Filter out chunks that don't have web URIs and remove duplicates
  const uniqueLinks = new Map();
  chunks.forEach(chunk => {
    if (chunk.web?.uri) {
      uniqueLinks.set(chunk.web.uri, chunk.web.title);
    }
  });

  if (uniqueLinks.size === 0) return null;

  return (
    <div className="mt-8 pt-5 border-t border-slate-100 dark:border-slate-700/50">
      <h4 className="text-xs font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2 font-display">
        <ExternalLink size={12} />
        Verified Sources
      </h4>
      <div className="flex flex-wrap gap-2">
        {Array.from(uniqueLinks.entries()).map(([uri, title], index) => (
          <a
            key={index}
            href={uri}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white px-3 py-1.5 rounded-lg transition-colors truncate max-w-[220px] border border-slate-200 dark:border-slate-800"
            title={title}
          >
            {title || new URL(uri).hostname}
          </a>
        ))}
      </div>
    </div>
  );
};