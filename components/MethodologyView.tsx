
import React from 'react';
import { Activity, Brain, Database, ShieldCheck, GitMerge, Zap } from 'lucide-react';

export const MethodologyView = () => {
  return (
    <div className="animate-fade-in max-w-4xl mx-auto space-y-12 pb-12">
        {/* Header Section */}
        <div className="text-center space-y-4 pt-4">
            <h1 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 dark:text-white">
                Predictive Architecture
            </h1>
            <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
                Probabilis utilizes a hybrid statistical engine combining large language model reasoning with rigorous stochastic simulations to forecast sports outcomes.
            </p>
        </div>

        {/* Core Pillars */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-slate-900/40 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl flex items-center justify-center mb-4 text-indigo-600 dark:text-indigo-400">
                    <Database size={20} />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2 font-display">Deep Data Ingestion</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    We parse granular box-score data in real-time, extracting efficiency metrics like Yards Per Play, Offensive Rating proxies, and xG efficiency to inform our models.
                </p>
            </div>
            <div className="bg-white dark:bg-slate-900/40 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div className="w-10 h-10 bg-rose-50 dark:bg-rose-900/20 rounded-xl flex items-center justify-center mb-4 text-rose-600 dark:text-rose-400">
                    <Zap size={20} />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2 font-display">Distribution Modeling</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    We model outcome distributions using matchup-specific volatility envelopes, Poisson/normal tails by sport, and non-terminal certainty caps so probabilities remain realistic before the game is decided.
                </p>
            </div>
            <div className="bg-white dark:bg-slate-900/40 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center mb-4 text-emerald-600 dark:text-emerald-400">
                    <Brain size={20} />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-2 font-display">Qualitative AI</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    Gemini 3 Flash provides the "Why" behind the numbers, analyzing matchups, injuries, and historical context to complement the rigorous math.
                </p>
            </div>
        </div>

        {/* Detailed Sections */}
        <div className="space-y-8">
            
            {/* Win Probability */}
            <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-start">
                <div className="md:w-1/3 md:sticky md:top-24">
                    <h3 className="text-xl font-bold font-display text-slate-900 dark:text-white mb-2">Win Probability</h3>
                    <div className="h-1 w-12 bg-indigo-500 rounded-full mb-4"></div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                        The core metric representing each outcome channel (home, away, and draw where applicable) after matchup priors, live context, and uncertainty caps are applied.
                    </p>
                </div>
                <div className="md:w-2/3 space-y-4">
                    <div className="bg-slate-50 dark:bg-slate-900/30 p-5 rounded-xl border border-slate-200 dark:border-slate-800">
                        <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-2">
                            <GitMerge size={16} className="text-indigo-500" />
                            Bayesian Blending
                        </h4>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            We treat pre-game odds and rankings as a "Prior". As the game progresses, we calculate a "Live Likelihood" based on real-time efficiency stats. The model dynamically shifts weight from the Prior to the Live Data as time expires, mirroring rigorous Bayesian inference.
                        </p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/30 p-5 rounded-xl border border-slate-200 dark:border-slate-800">
                        <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-2">
                            <Activity size={16} className="text-indigo-500" />
                            Field Position Awareness
                        </h4>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            For Football, our simulations incorporate Expected Points (EP) based on current field position, down, and distance, instantly rewarding teams for driving into the Red Zone before they even score.
                        </p>
                    </div>
                </div>
            </div>

            <div className="w-full h-px bg-slate-200 dark:bg-slate-800"></div>

            {/* Predicted Score */}
            <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-start">
                <div className="md:w-1/3 md:sticky md:top-24">
                    <h3 className="text-xl font-bold font-display text-slate-900 dark:text-white mb-2">Predicted Score</h3>
                    <div className="h-1 w-12 bg-emerald-500 rounded-full mb-4"></div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                        The most likely scoreline derived from the mean of outcome distributions.
                    </p>
                </div>
                <div className="md:w-2/3 space-y-4">
                    <div className="bg-slate-50 dark:bg-slate-900/30 p-5 rounded-xl border border-slate-200 dark:border-slate-800">
                        <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-2">Sport-Specific Volatility</h4>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-3">
                            Different sports require different standard deviation inputs for the simulation:
                        </p>
                        <ul className="list-disc list-inside text-sm text-slate-600 dark:text-slate-400 space-y-1 ml-1">
                            <li><strong>Soccer & Hockey:</strong> Modeled with Low Volatility (&lt; 1.0) to reflect scarcity of scoring.</li>
                            <li><strong>Basketball:</strong> Medium Volatility, high volume.</li>
                            <li><strong>Football:</strong> High Volatility (7.0) to account for the discrete, chunk-based nature of scoring (Touchdowns).</li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="w-full h-px bg-slate-200 dark:bg-slate-800"></div>

             {/* Confidence Interval */}
             <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-start">
                <div className="md:w-1/3 md:sticky md:top-24">
                    <h3 className="text-xl font-bold font-display text-slate-900 dark:text-white mb-2">Confidence Index</h3>
                    <div className="h-1 w-12 bg-rose-500 rounded-full mb-4"></div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                        A single score showing how sure the model is right now, based on data quality and how clear the matchup edge is.
                    </p>
                </div>
                <div className="md:w-2/3 space-y-4">
                    <div className="bg-slate-50 dark:bg-slate-900/30 p-5 rounded-xl border border-slate-200 dark:border-slate-800">
                        <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-2">
                            <ShieldCheck size={16} className="text-rose-500" />
                            Statistical Certainty
                        </h4>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mt-2">
                            We start with a base score, then add points for:
                            data coverage, separation between the top two outcomes, strength of the biggest matchup edges, and live-game progress.
                            <span className="font-mono"> 34 + coverage*30 + decisiveness*24 + evidence*8 + liveProgress*20</span>
                        </p>
                    </div>
                </div>
            </div>

        </div>
    </div>
  );
};
