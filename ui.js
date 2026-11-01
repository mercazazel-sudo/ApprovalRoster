import {
    cfg, saveCfg, chatState, saveChatState, emptyCompanion, clipScore,
    STATUSES, MIN_SCORE, MAX_SCORE, esc, toast,
} from './config.js';
import { judgeLatestMessage, isBusy, fetchJudgeModels } from './judge.js';

let activeTab = 'companions';
let windowOpen = false;

function scoreTone(score) {
    const s = clipScore(score);
    if (s > 8) return 'warm';
    if (s < -8) return 'cold';
    return 'even';
}

function scoreBar(score, extraClass = '') {
    const s = clipScore(score);
    const pct = ((s - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * 100;
    return `<div class="ar-meter ${extraClass}" title="${s}">
        <div class="ar-meter-track">
            <span class="ar-meter-neg"></span>
            <span class="ar-meter-pos"></span>
            <span class="ar-meter-zero"></span>
            <span class="ar-meter-thumb" style="left:${pct}%"></span>
        </div>
    </div>`;
}

function statusLabel(id) {
    return STATUSES.find(s => s.id === id)?.label || 'нейтрал';
}

function statusOptions(current) {
    return STATUSES.map(s =>
        `<option value="${s.id}"${s.id === current ? ' selected' : ''}>${esc(s.label)}</option>`
    ).join('');
}

function deltaChip(delta) {
    if (!delta) return '';
    const up = delta > 0;
    return `<span class="ar-chip ${up ? 'ar-chip-up' : 'ar-chip-down'}">${up ? '+1' : '−1'}</span>`;
}

export function refreshWidget() {
    const root = document.getElementById('ar-widget');
    if (!root) return;
    const c = cfg();
    root.classList.toggle('ar-hidden', !c.enabled || !c.widgetVisible);
    root.classList.toggle('ar-collapsed', !!c.widgetCollapsed);
    const collapseButton = document.getElementById('ar-widget-collapse');
    if (collapseButton) {
        collapseButton.title = c.widgetCollapsed ? 'Развернуть одобрение' : 'Свернуть одобрение';
        collapseButton.setAttribute('aria-label', collapseButton.title);
        collapseButton.setAttribute('aria-expanded', String(!c.widgetCollapsed));
        collapseButton.innerHTML = c.widgetCollapsed
            ? '<i class="fa-solid fa-heart"></i>'
            : '<i class="fa-solid fa-minus"></i>';
    }
    const st = chatState();
    const list = (st.companions || []).filter(x => x.name?.trim());
    const body = document.getElementById('ar-widget-list');
    if (!body) return;
    if (!list.length) {
        body.innerHTML = '<div class="ar-empty">Добавь компаньонов в окне</div>';
        return;
    }
    body.innerHTML = list.map(x => {
        const tone = scoreTone(x.score);
        return `<div class="ar-w-row ar-tone-${tone}">
            <div class="ar-w-top">
                <span class="ar-w-name">${esc(x.name)}</span>
                ${deltaChip(x.lastDelta)}
                <span class="ar-w-num">${clipScore(x.score)}</span>
            </div>
            ${scoreBar(x.score, 'ar-meter-widget')}
        </div>`;
    }).join('');
}

function bindWidgetDrag(el) {
    const head = el.querySelector('#ar-widget-head');
    if (!head) return;
    let drag = null;
    head.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button')) return;
        drag = { x: e.clientX - el.offsetLeft, y: e.clientY - el.offsetTop };
        el.classList.add('ar-dragging');
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!drag) return;
        const left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, e.clientX - drag.x));
        const top = Math.max(8, Math.min(window.innerHeight - 40, e.clientY - drag.y));
        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
        if (!drag) return;
        drag = null;
        el.classList.remove('ar-dragging');
        cfg().widgetPos = { left: el.offsetLeft, top: el.offsetTop };
        saveCfg();
    });
}

export function createWidget() {
    if (document.getElementById('ar-widget')) {
        refreshWidget();
        return;
    }
    const el = document.createElement('div');
    el.id = 'ar-widget';
    el.innerHTML = `
        <div class="ar-w-head" id="ar-widget-head">
            <span class="ar-w-title">одобрение</span>
            <span class="ar-w-range">−100 · 100</span>
            <button type="button" class="ar-icon-btn ar-collapse-btn" id="ar-widget-collapse" title="Свернуть одобрение" aria-label="Свернуть одобрение" aria-expanded="true">
                <i class="fa-solid fa-minus"></i>
            </button>
            <button type="button" class="ar-icon-btn" id="ar-widget-open" title="Открыть окно">
                <i class="fa-solid fa-up-right-from-square"></i>
            </button>
        </div>
        <div id="ar-widget-list" class="ar-w-list"></div>
    `;
    document.body.appendChild(el);
    const pos = cfg().widgetPos;
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        el.style.left = pos.left + 'px';
        el.style.top = pos.top + 'px';
        el.style.right = 'auto';
    }
    el.querySelector('#ar-widget-open')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openPanel();
    });
    el.querySelector('#ar-widget-collapse')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const c = cfg();
        c.widgetCollapsed = !c.widgetCollapsed;
        saveCfg();
        refreshWidget();
    });
    el.querySelector('#ar-widget-head')?.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        openPanel();
    });
    bindWidgetDrag(el);
    refreshWidget();
}

function companionCard(c) {
    const name = c.name?.trim() || 'без имени';
    return `<article class="ar-card" data-id="${esc(c.id)}">
        <header class="ar-card-head">
            <div>
                <div class="ar-card-title">${esc(name)}</div>
                <div class="ar-card-sub">${esc(statusLabel(c.status))} · ${clipScore(c.score)}</div>
            </div>
            ${deltaChip(c.lastDelta)}
        </header>
        ${scoreBar(c.score, 'ar-meter-card')}
        ${c.lastReason ? `<p class="ar-reason">${esc(c.lastReason)}</p>` : ''}
        <label>Имя в тексте
            <input class="ar-in ar-name" type="text" value="${esc(c.name)}" placeholder="Астарион">
        </label>
        <label>Крючки
            <input class="ar-in ar-hooks" type="text" value="${esc(c.hooks)}" placeholder="Astarion, вампир, бледный эльф">
        </label>
        <label>Заметка для судьи
            <textarea class="ar-in ar-prompt" rows="2" placeholder="Кто он в мире, коротко">${esc(c.prompt)}</textarea>
        </label>
        <div class="ar-two">
            <label>Одобряет
                <textarea class="ar-in ar-ap" rows="5" placeholder="по строке">${esc(c.approves)}</textarea>
            </label>
            <label>Не одобряет
                <textarea class="ar-in ar-dis" rows="5" placeholder="по строке">${esc(c.disapproves)}</textarea>
            </label>
        </div>
        <div class="ar-row">
            <label>Очки
                <input class="ar-in ar-score" type="number" min="${MIN_SCORE}" max="${MAX_SCORE}" value="${clipScore(c.score)}">
            </label>
            <label>Статус
                <select class="ar-in ar-status">${statusOptions(c.status || 'neutral')}</select>
            </label>
            <button type="button" class="ar-ghost-btn ar-del">Удалить</button>
        </div>
    </article>`;
}

function companionsHTML() {
    const st = chatState();
    const list = st.companions || [];
    return `
        <div class="ar-toolbar">
            <div>
                <div class="ar-kicker">этот чат</div>
                <h3>Компаньоны</h3>
            </div>
            <div class="ar-toolbar-actions">
                <button type="button" class="ar-btn" id="ar-judge-now">Оценить ход</button>
                <button type="button" class="ar-btn ar-btn-primary" id="ar-add">Добавить</button>
            </div>
        </div>
        <div id="ar-list" class="ar-list">
            ${list.map(companionCard).join('') || '<div class="ar-empty-block">Пока никого. Добавь 5–6 имён, как они звучат в тексте.</div>'}
        </div>
    `;
}

function settingsHTML() {
    const c = cfg();
    return `
        <div class="ar-toolbar">
            <div>
                <div class="ar-kicker">судья</div>
                <h3>Настройки</h3>
            </div>
        </div>
        <div class="ar-switches">
            <label class="ar-switch"><input id="ar-enabled" type="checkbox"${c.enabled ? ' checked' : ''}><span>Судья включён</span></label>
            <label class="ar-switch"><input id="ar-widget-vis" type="checkbox"${c.widgetVisible ? ' checked' : ''}><span>Показывать виджет</span></label>
        </div>
        <div class="ar-api-box">
            <div class="ar-kicker">отдельное подключение</div>
            <p class="ar-hint">Свой URL, ключ и модель. Основной чат таверны не трогаем.</p>
            <label>API URL
                <input id="ar-api-url" type="text" value="${esc(c.apiUrl)}" placeholder="https://api.openai.com/v1">
            </label>
            <label>API ключ
                <input id="ar-api-key" type="password" value="${esc(c.apiKey)}" placeholder="sk-..." autocomplete="off">
            </label>
            <label>Модель
                <div class="ar-model-row">
                    <input id="ar-api-model" type="text" value="${esc(c.apiModel)}" placeholder="glm-4-flash" list="ar-model-list">
                    <button type="button" class="ar-btn" id="ar-fetch-models" title="Подтянуть список">Список</button>
                </div>
                <datalist id="ar-model-list"></datalist>
            </label>
            <label>Сообщений в контексте
                <input id="ar-ctx" type="number" min="1" max="40" value="${parseInt(c.contextMessages, 10) || 8}">
            </label>
        </div>
        <label class="ar-prompt-label">Промпт судьи
            <textarea id="ar-judge" rows="12">${esc(c.judgePrompt)}</textarea>
        </label>
    `;
}

function windowHTML() {
    return `
        <div class="ar-window" id="ar-window" role="dialog" aria-label="Approval Roster">
            <div class="ar-win-head" id="ar-win-head">
                <div class="ar-win-brand">
                    <span class="ar-win-mark"></span>
                    Approval Roster
                </div>
                <nav class="ar-tabs">
                    <button type="button" class="ar-tab${activeTab === 'companions' ? ' is-on' : ''}" data-tab="companions">Компаньоны</button>
                    <button type="button" class="ar-tab${activeTab === 'settings' ? ' is-on' : ''}" data-tab="settings">Настройки</button>
                </nav>
                <button type="button" class="ar-icon-btn" id="ar-win-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="ar-win-body" id="ar-panel-inner"></div>
        </div>
    `;
}

function readCompanionFromCard(card) {
    const st = chatState();
    const c = (st.companions || []).find(x => x.id === card.dataset.id);
    if (!c) return;
    c.name = card.querySelector('.ar-name')?.value?.trim() || '';
    c.hooks = card.querySelector('.ar-hooks')?.value || '';
    c.prompt = card.querySelector('.ar-prompt')?.value || '';
    c.approves = card.querySelector('.ar-ap')?.value || '';
    c.disapproves = card.querySelector('.ar-dis')?.value || '';
    c.score = clipScore(card.querySelector('.ar-score')?.value);
    c.status = card.querySelector('.ar-status')?.value || 'neutral';
}

function bindCompanionCards(host) {
    host.querySelectorAll('.ar-card').forEach(card => {
        const saveOne = () => {
            readCompanionFromCard(card);
            saveChatState();
            const c = (chatState().companions || []).find(x => x.id === card.dataset.id);
            const title = card.querySelector('.ar-card-title');
            const sub = card.querySelector('.ar-card-sub');
            if (title) title.textContent = c?.name || 'без имени';
            if (sub && c) sub.textContent = `${statusLabel(c.status)} · ${clipScore(c.score)}`;
            refreshWidget();
        };
        card.querySelectorAll('.ar-in').forEach(inp => inp.addEventListener('change', saveOne));
        card.querySelector('.ar-del')?.addEventListener('click', () => {
            const st = chatState();
            st.companions = (st.companions || []).filter(x => x.id !== card.dataset.id);
            saveChatState();
            renderPanel();
        });
    });
}

function bindSettings(host) {
    const saveField = (sel, write) => {
        host.querySelector(sel)?.addEventListener('change', (e) => {
            write(e.target);
            saveCfg();
        });
    };
    saveField('#ar-enabled', (el) => {
        cfg().enabled = !!el.checked;
        refreshWidget();
    });
    saveField('#ar-widget-vis', (el) => {
        cfg().widgetVisible = !!el.checked;
        refreshWidget();
    });
    saveField('#ar-api-url', (el) => { cfg().apiUrl = el.value.trim(); });
    saveField('#ar-api-key', (el) => { cfg().apiKey = el.value.trim(); });
    saveField('#ar-api-model', (el) => { cfg().apiModel = el.value.trim(); });
    saveField('#ar-ctx', (el) => {
        cfg().contextMessages = Math.max(1, Math.min(40, parseInt(el.value, 10) || 8));
    });
    saveField('#ar-judge', (el) => { cfg().judgePrompt = el.value || ''; });

    host.querySelector('#ar-fetch-models')?.addEventListener('click', async () => {
        cfg().apiUrl = host.querySelector('#ar-api-url')?.value?.trim() || '';
        cfg().apiKey = host.querySelector('#ar-api-key')?.value?.trim() || '';
        saveCfg();
        try {
            const models = await fetchJudgeModels();
            const list = host.querySelector('#ar-model-list');
            if (list) list.innerHTML = models.map(m => `<option value="${esc(m)}"></option>`).join('');
            toast('success', 'Моделей: ' + models.length);
        } catch (e) {
            toast('error', e.message || String(e));
        }
    });
}

export function renderPanel() {
    const host = document.getElementById('ar-panel-inner');
    if (!host) return;
    host.innerHTML = activeTab === 'settings' ? settingsHTML() : companionsHTML();
    if (activeTab === 'settings') bindSettings(host);
    else {
        host.querySelector('#ar-add')?.addEventListener('click', () => {
            chatState().companions.push(emptyCompanion());
            saveChatState();
            renderPanel();
        });
        host.querySelector('#ar-judge-now')?.addEventListener('click', async () => {
            if (isBusy()) {
                toast('warning', 'Судья уже работает');
                return;
            }
            await judgeLatestMessage({ force: true });
            renderPanel();
            refreshWidget();
        });
        bindCompanionCards(host);
    }
    document.querySelectorAll('.ar-tab').forEach(btn => {
        btn.classList.toggle('is-on', btn.dataset.tab === activeTab);
    });
    refreshWidget();
}

function closePanel() {
    document.getElementById('ar-overlay')?.remove();
    windowOpen = false;
}

function bindWindowChrome(overlay) {
    overlay.querySelector('#ar-win-close')?.addEventListener('click', closePanel);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closePanel();
    });
    overlay.querySelectorAll('.ar-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            activeTab = btn.dataset.tab === 'settings' ? 'settings' : 'companions';
            renderPanel();
        });
    });
}

export function openPanel() {
    try { $('#extensionsMenu').hide(); } catch { /* ignore */ }
    if (windowOpen && document.getElementById('ar-overlay')) {
        renderPanel();
        return;
    }
    document.getElementById('ar-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'ar-overlay';
    overlay.innerHTML = windowHTML();
    document.body.appendChild(overlay);
    windowOpen = true;
    bindWindowChrome(overlay);
    renderPanel();
}

export function injectSettings() {
    if (document.getElementById('ar-ext-settings')) return true;
    const host = document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    if (!host) return false;
    const wrap = document.createElement('div');
    wrap.id = 'ar-ext-settings';
    wrap.className = 'extension_container';
    wrap.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Approval Roster</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <p class="ar-ext-hint">Шкалы одобрения компаньонов. Настройки и ростер — в отдельном окне.</p>
                <div class="flex-container flexGap5">
                    <button type="button" class="menu_button" id="ar-ext-open">
                        <i class="fa-solid fa-up-right-from-square"></i>
                        <span>Открыть окно</span>
                    </button>
                </div>
            </div>
        </div>
    `;
    wrap.querySelector('#ar-ext-open')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPanel();
    });
    host.appendChild(wrap);
    return true;
}

export function registerWand() {
    if (document.getElementById('ar-wand-item')) return true;
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;
    const item = document.createElement('div');
    item.id = 'ar-wand-item';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<i class="fa-solid fa-scale-balanced"></i><span>Approval Roster</span>';
    item.addEventListener('click', () => openPanel());
    menu.appendChild(item);
    return true;
}

export function refreshOpenWindow() {
    if (!document.getElementById('ar-overlay')) return;
    if (activeTab === 'companions' && document.activeElement?.closest?.('#ar-list')) {
        refreshWidget();
        return;
    }
    renderPanel();
}
