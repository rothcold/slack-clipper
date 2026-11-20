import type { Row } from '../src/clip';
export const prose = (text: string): Row[] => [{ kind: 'section', runs: [{ text }] }];
export const visible = (rows: Row[]) => rows.map(row => row.runs.map(r => r.text).join('')).join('\n');
