import {
    cfg, chatState, saveChatState, clipScore, parseHooks, parseLines,
    toast, personaName, getChat, messageKey,
} from './config.js';

let busy = false;

export function isBusy() {
    return busy;
}

function messageBody(m) {
    return String(m?.mes || '').replace(/<!--[\s\S]*?-->/g, '').trim();
}

function sceneText(limit) {
    const chat = getChat();
    const n = Math.max(1, Math.min(40, parseInt(limit, 10) || 8));
    const slice = chat.slice(-n);
    return slice.map(m => {
        if (!m) return '';
        const who = m.is_user ? (personaName() + ' (player)') : (m.name || 'Narrator');
        const body = messageBody(m);
        return who + ': ' + body;
    }).filter(Boolean).join('\n\n');
}

function beatText() {
    const chat = getChat();
    if (!chat.length) return '';
    const last = chat[chat.length - 1];
    const prev = chat.length > 1 ? chat[chat.length - 2] : null;
    const parts = [];
    if (last && !last.is_user) parts.push(messageBody(last));
    if (prev?.is_user) parts.push(messageBody(prev));
    if (last?.is_user) parts.push(messageBody(last));
    return parts.filter(Boolean).join('\n');
}

export function companionPresent(companion, text) {
    const hay = String(text || '').toLowerCase();
    if (!hay) return false;
    const hooks = parseHooks(companion.hooks);
    const names = [companion.name, ...hooks].map(s => String(s || '').trim()).filter(Boolean);
    return names.some(h => hay.includes(h.toLowerCase()));
}

function presentCompanions(st, text) {
    return (st.companions || []).filter(c => c.name?.trim() && companionPresent(c, text));
}

function extractJson(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    const cleaned = s.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim();
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try {
        return JSON.parse(cleaned.slice(a, b + 1));
    } catch {
        return null;
    }
}

function normalizeDeltas(parsed, allowedNames) {
    const allow = new Set(allowedNames.map(n => n.toLowerCase()));
    const rows = Array.isArray(parsed?.deltas) ? parsed.deltas : [];
    const out = [];
    for (const row of rows) {
        const name = String(row?.name || '').trim();
        if (!name || !allow.has(name.toLowerCase())) continue;
        let delta = Number(row?.delta);
        if (delta > 0) delta = 1;
        else if (delta < 0) delta = -1;
        else delta = 0;
        out.push({
            name,
            delta,
            reason: String(row?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        });
    }
    return out;
}

function trimSlash(url) {
    return String(url || '').trim().replace(/\/+$/, '');
}

function completionsUrl(base) {
    const url = trimSlash(base);
    if (!url) throw new Error('Нет API URL судьи');
    if (/\/chat\/completions$/i.test(url)) return url;
    return url + '/chat/completions';
}

function modelsUrl(base) {
    const url = trimSlash(base);
    if (!url) throw new Error('Нет API URL судьи');
    if (/\/models$/i.test(url)) return url;
    return url.replace(/\/chat\/completions$/i, '') + '/models';
}

async function corsAwareFetch(url, init) {
    try {
        return await fetch(url, init);
    } catch (err) {
        if (!(err instanceof TypeError)) throw err;
        const proxyUrl = `${location.origin}/proxy?url=${encodeURIComponent(url)}`;
        try {
            return await fetch(proxyUrl, init);
        } catch {
            throw new Error('CORS. В config.yaml включи enableCorsProxy: true и перезапусти таверну.');
        }
    }
}

function authHeaders(apiKey) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    return headers;
}

function extractChatText(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;
    const choice = data.choices?.[0];
    const message = choice?.message || {};
    let msg = message.content
        || message.reasoning_content
        || message.reasoning
        || choice?.text
        || data.content
        || '';
    if (Array.isArray(msg)) {
        return msg.map(p => (typeof p === 'string' ? p : (p?.text || p?.reasoning || ''))).join('');
    }
    if (typeof msg === 'object' && msg) {
        msg = msg.text || msg.content || '';
    }
    return String(msg || '');
}

async function callJudge(system, user) {
    const c = cfg();
    const apiUrl = trimSlash(c.apiUrl);
    const apiKey = String(c.apiKey || '').trim();
    const model = String(c.apiModel || '').trim();
    if (!apiUrl) throw new Error('Укажи API URL судьи во вкладке Настройки');
    if (!model) throw new Error('Укажи модель судьи во вкладке Настройки');
    const payload = {
        model,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_tokens: 800,
        stream: false,
        response_format: { type: 'json_object' },
    };
    const url = completionsUrl(apiUrl);
    const headers = authHeaders(apiKey);
    let resp = await corsAwareFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
    let rawBody = await resp.text();
    if (!resp.ok && payload.response_format) {
        delete payload.response_format;
        resp = await corsAwareFetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        rawBody = await resp.text();
    }
    if (!resp.ok) {
        throw new Error('Судья HTTP ' + resp.status + ': ' + rawBody.slice(0, 180));
    }
    let data = rawBody;
    try { data = JSON.parse(rawBody); } catch { /* plain text */ }
    const text = extractChatText(data);
    if (!String(text).trim()) throw new Error('Судья вернул пустой ответ');
    return String(text);
}

export async function fetchJudgeModels() {
    const c = cfg();
    const apiUrl = trimSlash(c.apiUrl);
    const apiKey = String(c.apiKey || '').trim();
    if (!apiUrl) throw new Error('Сначала укажи API URL');
    const resp = await corsAwareFetch(modelsUrl(apiUrl), {
        method: 'GET',
        headers: authHeaders(apiKey),
    });
    const rawBody = await resp.text();
    if (!resp.ok) throw new Error('Модели HTTP ' + resp.status + ': ' + rawBody.slice(0, 180));
    let data;
    try { data = JSON.parse(rawBody); } catch {
        throw new Error('Список моделей — не JSON');
    }
    const rows = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    return rows.map(m => String(m?.id || m?.name || '').trim()).filter(Boolean);
}

function buildUserPrompt(present, scene) {
    const blocks = present.map(c => {
        const ap = parseLines(c.approves).map(x => '- ' + x).join('\n') || '- (none)';
        const dis = parseLines(c.disapproves).map(x => '- ' + x).join('\n') || '- (none)';
        const dossier = String(c.prompt || '').trim();
        return [
            'COMPANION: ' + c.name.trim(),
            dossier ? ('Note: ' + dossier) : '',
            'APPROVES:\n' + ap,
            'DISAPPROVES:\n' + dis,
            'Current score: ' + clipScore(c.score),
        ].filter(Boolean).join('\n');
    }).join('\n\n');

    return [
        'PLAYER PERSONA: ' + personaName(),
        '',
        'WITNESS GATE (mandatory):',
        '- Score a companion only if they witnessed or were told the PLAYER action in THIS beat.',
        '- Being in the camp, party, or older messages is not witnessing.',
        '- Narrator omniscience, inner thoughts, dreams, and secret/solo/night deeds are not companion knowledge.',
        '- If they did not see, hear, or get told it: delta 0.',
        '- If unsure: delta 0.',
        '',
        'PRESENT COMPANIONS (candidates only; still apply witness gate):',
        blocks,
        '',
        'SCENE (context only, not proof of presence):',
        scene,
        '',
        'Return JSON only.',
    ].join('\n');
}

function snapshotScores(st) {
    const map = {};
    for (const c of st.companions || []) map[c.id] = clipScore(c.score);
    return map;
}

function restoreScores(st, map) {
    if (!map) return;
    for (const c of st.companions || []) {
        if (Object.hasOwn(map, c.id)) {
            c.score = clipScore(map[c.id]);
            c.lastDelta = 0;
            c.lastReason = '';
        }
    }
}

function applyDeltas(st, deltas) {
    const byName = new Map((st.companions || []).map(c => [c.name.trim().toLowerCase(), c]));
    const applied = [];
    for (const row of deltas) {
        const c = byName.get(row.name.toLowerCase());
        if (!c) continue;
        const next = clipScore(c.score + row.delta);
        const real = next - clipScore(c.score);
        c.score = next;
        c.lastDelta = real;
        c.lastReason = row.reason || '';
        if (real !== 0) {
            st.log.unshift({
                t: Date.now(),
                name: c.name,
                delta: real,
                reason: c.lastReason,
            });
            applied.push(c.name + (real > 0 ? ' +1' : ' −1'));
        }
    }
    st.log = (st.log || []).slice(0, 80);
    return applied;
}

export async function judgeLatestMessage({ force = false } = {}) {
    const c = cfg();
    if (!c.enabled && !force) return;
    if (busy) return;
    const st = chatState();
    if (!(st.companions || []).some(x => x.name?.trim())) return;

    const chat = getChat();
    if (!chat.length) return;
    const idx = chat.length - 1;
    const msg = chat[idx];
    if (!msg || msg.is_user) return;

    const key = messageKey(msg, idx);
    if (!force && st.lastJudgedKey === key) return;

    const scene = sceneText(c.contextMessages);
    const present = presentCompanions(st, beatText());
    if (!present.length) {
        st.lastJudgedKey = key;
        saveChatState();
        return { skipped: 'nobody-present' };
    }

    busy = true;
    try {
        st.snapshots[String(idx)] = snapshotScores(st);
        const raw = await callJudge(c.judgePrompt || '', buildUserPrompt(present, scene));
        const parsed = extractJson(raw);
        if (!parsed) throw new Error('Не JSON от судьи');
        const deltas = normalizeDeltas(parsed, present.map(x => x.name.trim()));
        const applied = applyDeltas(st, deltas);
        st.lastJudgedKey = key;
        saveChatState();
        if (applied.length) toast('info', applied.join(', '));
        return { ok: true, applied };
    } catch (e) {
        toast('error', e.message || String(e));
        return { error: e.message || String(e) };
    } finally {
        busy = false;
    }
}

export function revertMessageIndex(idx) {
    const st = chatState();
    const snap = st.snapshots?.[String(idx)];
    if (!snap) return false;
    restoreScores(st, snap);
    st.lastJudgedKey = '';
    saveChatState();
    return true;
}

export async function onSwipe(mesId, after) {
    try {
        const chat = getChat();
        const idx = Number.isInteger(mesId) ? mesId : chat.length - 1;
        const msg = chat[idx];
        if (!msg || msg.is_user) return;
        revertMessageIndex(idx);
        await judgeLatestMessage({ force: true });
        after?.();
    } catch (e) {
        toast('error', e.message || String(e));
    }
}

export function onDeleted(newLen, after) {
    try {
        const st = chatState();
        const keys = Object.keys(st.snapshots || {});
        let restored = false;
        for (const k of keys) {
            const i = parseInt(k, 10);
            if (Number.isFinite(i) && i >= newLen) {
                if (!restored) {
                    restoreScores(st, st.snapshots[k]);
                    restored = true;
                }
                delete st.snapshots[k];
            }
        }
        st.lastJudgedKey = '';
        saveChatState();
        after?.();
    } catch (e) {
        toast('error', e.message || String(e));
    }
}
