import { eventSource, event_types } from '../../../../script.js';
import { cfg } from './config.js';
import { judgeLatestMessage, onSwipe, onDeleted } from './judge.js';
import { createWidget, refreshWidget, registerWand, injectSettings, refreshOpenWindow } from './ui.js';

function afterUi() {
    try { refreshWidget(); } catch { /* ignore */ }
    try { refreshOpenWindow(); } catch { /* ignore */ }
}

jQuery(() => {
    try {
        cfg();
        createWidget();

        const mountChrome = () => {
            registerWand();
            injectSettings();
        };
        if (!registerWand() || !injectSettings()) {
            let n = 0;
            const iv = setInterval(() => {
                if ((registerWand() && injectSettings()) || ++n > 40) clearInterval(iv);
            }, 250);
            try {
                if (event_types.APP_READY) eventSource.on(event_types.APP_READY, mountChrome);
            } catch { /* ignore */ }
        }

        eventSource.on(event_types.MESSAGE_RECEIVED, async (_id, type) => {
            if (type === 'swipe' || type === 'regenerate' || type === 'continue') {
                await onSwipe(_id, afterUi);
                return;
            }
            await judgeLatestMessage();
            afterUi();
        });

        if (event_types.MESSAGE_SWIPED) {
            eventSource.on(event_types.MESSAGE_SWIPED, (mesId) => onSwipe(mesId, afterUi));
        }
        if (event_types.MESSAGE_DELETED) {
            eventSource.on(event_types.MESSAGE_DELETED, (len) => onDeleted(len, afterUi));
        }
        if (event_types.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, () => afterUi());
        }
        if (event_types.APP_READY) {
            eventSource.on(event_types.APP_READY, () => {
                createWidget();
                registerWand();
                injectSettings();
                afterUi();
            });
        }
    } catch (e) {
        console.error('[Approval Roster] init', e);
        try { toastr?.error?.('Approval Roster: ' + e.message); } catch { /* ignore */ }
    }
});
