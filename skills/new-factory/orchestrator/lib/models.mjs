// Models by size, as the design's table says. A "hard" fix from round 3 on takes
// the stronger model (S -> Sonnet, M -> Opus, L -> Opus at the highest effort).
export const IMPLEMENTER = { S: { model: 'haiku' }, M: { model: 'sonnet' }, L: { model: 'opus' } };
export const ESCALATED = { S: { model: 'sonnet' }, M: { model: 'opus' }, L: { model: 'opus', effort: 'max' } };
export const REVIEWER = { M: { model: 'sonnet' }, L: { model: 'opus' } };
export const ARBITER = { model: 'opus' };
export const DIAGNOSER = { model: 'sonnet' };
export const QC = { model: 'sonnet' };

export const implementerModel = (size, escalate = false) => (escalate ? ESCALATED[size] : IMPLEMENTER[size]);
