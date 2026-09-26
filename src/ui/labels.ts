const GREEK: Record<string, string> = { sigma: 'σ', beta: 'β', rho: 'ρ', alpha: 'α' };

/** Display label for a parameter name (Greek letters where the equations use them). */
export const paramLabel = (name: string) => GREEK[name] ?? name;
