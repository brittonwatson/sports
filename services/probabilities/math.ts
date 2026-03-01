
export const normalCDF = (x: number, mean: number, std: number): number => {
    const z = (x - mean) / std;
    return 0.5 * (1 + (Math.sign(z) * Math.sqrt(1 - Math.exp(-2 * z * z / Math.PI))));
};

export const clamp = (val: number, min: number, max: number): number => {
    return Math.max(min, Math.min(max, val));
};

export const factorial = (n: number): number => {
    if (n === 0 || n === 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
};

export const poissonProbability = (k: number, lambda: number): number => {
    if (lambda <= 0 && k === 0) return 1;
    if (lambda <= 0) return 0;
    // Use log-gamma or simple formulation for small numbers
    // For sports scores (0-10), direct calc is fine
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
};

export const calculateSigmoidWinProb = (ratingDiff: number, volatility: number = 400): number => {
    return 1 / (1 + Math.pow(10, -ratingDiff / volatility));
};

export const parseClockToMinutes = (clockStr: string): number => {
    if (!clockStr) return 0;
    
    const str = clockStr.trim();
    const normalized = str.replace(/[’]/g, "'");

    // Handle soccer stoppage-time formats like "45+2" or "90+4"
    if (normalized.includes('+')) {
        const parts = normalized.split('+');
        if (parts.length === 2) {
            const base = parseFloat(parts[0].replace(/[^0-9.-]/g, ""));
            const extra = parseFloat(parts[1].replace(/[^0-9.-]/g, ""));
            if (!isNaN(base) && !isNaN(extra)) return base + extra;
        }
    }

    // Handle soccer minute markers like "72'" or "45'"
    if (normalized.includes("'")) {
        const val = parseFloat(normalized.replace(/[^0-9.-]/g, ""));
        return isNaN(val) ? 0 : val;
    }

    // Handle MM:SS format (e.g. "12:00", "0:45")
    if (normalized.includes(':')) {
        const parts = normalized.split(':');
        if (parts.length === 2) {
            return parseInt(parts[0]) + (parseFloat(parts[1]) / 60);
        }
    }
    
    // Handle floating point seconds (e.g. "45.2", "0.5")
    if (normalized.includes('.')) {
        const val = parseFloat(normalized.replace(/[^0-9.-]/g, ""));
        if (isNaN(val)) return 0;
        // If the value is within typical period-minute bounds, treat it as minutes.
        if (val <= 20) return val;
        return val / 60;
    }

    // Handle plain integers
    const val = parseFloat(normalized.replace(/[^0-9.-]/g, ""));
    if (isNaN(val)) return 0;

    // Heuristic for integers without colons:
    // If value <= 20, assume Minutes (e.g. "12", "6", "5")
    // If value > 20, assume Seconds (e.g. "45", "30")
    // Note: NCAA halves are 20 mins. "20" could be 20:00 or 0:20? 
    // Standard scoreboards usually use 20:00. 
    // This heuristic prioritizes minutes for typical quarter lengths (12 or 15).
    if (val <= 20) {
        return val;
    }
    
    return val / 60;
};

export const parseMetric = (val: string): number => {
    if (!val) return 0;
    return parseFloat(val.replace(/[^0-9.-]/g, ''));
};
