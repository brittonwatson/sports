
export const normalCDF = (x: number, mean: number, std: number): number => {
    const z = (x - mean) / std;
    return 0.5 * (1 + (Math.sign(z) * Math.sqrt(1 - Math.exp(-2 * z * z / Math.PI))));
};

export const poissonProbability = (k: number, lambda: number): number => {
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
};

export const factorial = (n: number): number => {
    if (n === 0 || n === 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
};

export const calculateSigmoidWinProb = (ratingDiff: number, volatility: number = 400): number => {
    return 1 / (1 + Math.pow(10, -ratingDiff / volatility));
};

export const parseClockToMinutes = (clockStr: string): number => {
    if (!clockStr) return 0;
    const parts = clockStr.split(':');
    if (parts.length === 2) {
        return parseInt(parts[0]) + (parseInt(parts[1]) / 60);
    }
    return 0;
};

export const parseMetric = (val: string): number => {
    if (!val) return 0;
    return parseFloat(val.replace(/[^0-9.-]/g, ''));
};
