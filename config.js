import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, saveMetadataDebounced } from '../../../extensions.js';

export const MODULE = 'approval_roster';
export const MIN_SCORE = -100;
export const MAX_SCORE = 100;
export const STATUSES = Object.freeze([
    { id: 'neutral', label: 'нейтрал' },
    { id: 'platonic', label: 'платоника' },
    { id: 'friendship', label: 'дружба' },
    { id: 'love', label: 'любовь' },
    { id: 'family', label: 'семья' },
    { id: 'hostility', label: 'вражда' },
]);

export const DEFAULT_JUDGE_PROMPT = [
    'You are an approval judge for a roleplay. You do not write story.',
    'For EACH listed companion who is PRESENT, decide if the PLAYER PERSONA\'s latest actions/words hit that companion\'s APPROVES or DISAPPROVES.',
    'Rules:',
    '- Output ONLY valid JSON. No markdown, no extra text.',
    '- delta must be exactly -1, 0, or 1.',
    '- +1 only if the scene clearly hits an approve item AND this companion witnessed or was told it.',
    '- -1 only if the scene clearly hits a disapprove item AND this companion witnessed or was told it.',
    '- If both hit, or neither, delta is 0.',
    '- Do not invent companions. Use the given names exactly.',
    '- Do not score anyone not in PRESENT.',
    '- This is approval/trust, not romance.',
    '- One change per companion per turn.',
    '- Knowledge is not omniscient. Narrator text is not companion knowledge.',
    '- Private, internal, solo, secret, or while-others-sleep deeds: delta 0 unless that companion is shown seeing/hearing/being told.',
    '- If unsure they witnessed THIS beat: delta 0.',
    'Schema: {"deltas":[{"name":"ExactName","delta":0,"reason":"short phrase"}]}',
].join('\n');

const LEGACY_JUDGE_PROMPTS = [
    [
        'You are an approval judge for a roleplay. You do not write story.',
        'For EACH listed companion who is PRESENT, decide if the PLAYER PERSONA\'s latest actions/words hit that companion\'s APPROVES or DISAPPROVES.',
        'Rules:',
        '- Output ONLY valid JSON. No markdown, no extra text.',
        '- delta must be exactly -1, 0, or 1.',
        '- +1 only if the scene clearly hits an approve item.',
        '- -1 only if the scene clearly hits a disapprove item.',
        '- If both hit, or neither, delta is 0.',
        '- Do not invent companions. Use the given names exactly.',
        '- Do not score anyone not in PRESENT.',
        '- This is approval/trust, not romance.',
        '- One change per companion per turn.',
        'Schema: {"deltas":[{"name":"ExactName","delta":0,"reason":"short phrase"}]}',
    ].join('\n'),
];

export const defaultSettings = Object.freeze({
    enabled: true,
    apiUrl: 'https://api.openai.com/v1',
    apiKey: '',
    apiModel: '',
    contextMessages: 8,
    judgePrompt: DEFAULT_JUDGE_PROMPT,
    widgetVisible: true,
    widgetCollapsed: false,
    widgetPos: null,
});

export function cfg() {
    if (!extension_settings[MODULE]) {
        extension_settings[MODULE] = structuredClone(defaultSettings);
    }
    const c = extension_settings[MODULE];
    for (const [k, v] of Object.entries(defaultSettings)) {
        if (c[k] === undefined) c[k] = structuredClone(v);
    }
    if (LEGACY_JUDGE_PROMPTS.includes(c.judgePrompt)) {
        c.judgePrompt = DEFAULT_JUDGE_PROMPT;
    }
    return c;
}

export function uid() {
    try {
        if (crypto?.randomUUID) return crypto.randomUUID();
    } catch { /* ignore */ }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function emptyCompanion(overrides = {}) {
    return {
        id: uid(),
        name: '',
        hooks: '',
        prompt: '',
        approves: '',
        disapproves: '',
        score: 0,
        status: 'neutral',
        lastDelta: 0,
        lastReason: '',
        ...overrides,
    };
}

export function emptyChatState() {
    return {
        companions: [],
        log: [],
        snapshots: {},
        lastJudgedKey: '',
    };
}

export function getContextSafe() {
    try {
        return SillyTavern?.getContext?.() || null;
    } catch {
        return null;
    }
}

export function chatState() {
    const ctx = getContextSafe();
    if (!ctx?.chatMetadata) return emptyChatState();
    if (!ctx.chatMetadata[MODULE] || typeof ctx.chatMetadata[MODULE] !== 'object') {
        ctx.chatMetadata[MODULE] = emptyChatState();
    }
    const st = ctx.chatMetadata[MODULE];
    if (!Array.isArray(st.companions)) st.companions = [];
    if (!Array.isArray(st.log)) st.log = [];
    if (!st.snapshots || typeof st.snapshots !== 'object') st.snapshots = {};
    if (typeof st.lastJudgedKey !== 'string') st.lastJudgedKey = '';
    return st;
}

export function saveChatState() {
    try {
        saveMetadataDebounced();
    } catch (e) {
        console.warn('[Approval Roster] saveMetadata:', e);
    }
}

export function saveCfg() {
    try {
        saveSettingsDebounced();
    } catch (e) {
        console.warn('[Approval Roster] saveSettings:', e);
    }
}

export function clipScore(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(v)));
}

export function parseHooks(raw) {
    return String(raw || '')
        .split(/[,;\n]/)
        .map(s => s.trim())
        .filter(Boolean);
}

export function parseLines(raw) {
    return String(raw || '')
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);
}

export function toast(type, msg) {
    try {
        if (typeof toastr !== 'undefined' && toastr[type]) toastr[type](msg, 'Approval Roster');
    } catch { /* ignore */ }
}

export function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function personaName() {
    const ctx = getContextSafe();
    return (ctx?.name1 || 'Player').trim() || 'Player';
}

export function getChat() {
    const ctx = getContextSafe();
    return Array.isArray(ctx?.chat) ? ctx.chat : [];
}

export function messageKey(msg, idx) {
    if (!msg) return String(idx);
    const swipe = msg.swipe_id ?? 0;
    const head = String(msg.mes || '').slice(0, 80);
    return `${idx}:${swipe}:${head}`;
}

