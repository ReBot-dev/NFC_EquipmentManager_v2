/*
 * Equipment Manager - Frontend
 * Manages screen transitions using a state machine pattern.
 */

// --- State ---
const state = {
    firstCard: null,
    secondCard: null,
    unregisteredIdm: null,
};

// --- NFC variables ---
let nfcCallback = null;
let nfcEventSource = null;
let nfcIgnoreIdm = null;

// --- Confirm dialog callbacks ---
let confirmYesCallback = null;
let confirmNoCallback = null;


// --------------------------------------------------
// View switching
// --------------------------------------------------

function switchView(viewName) {
    if (nfcEventSource && viewName !== 'nfc-wait') {
        nfcEventSource.close();
        nfcEventSource = null;
    }

    document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active');
    });
    document.getElementById('view-' + viewName).classList.add('active');
}


// --------------------------------------------------
// API helpers
// --------------------------------------------------

async function apiGet(url) {
    const response = await fetch(url);
    return response.json();
}

async function apiPost(url, data) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return response.json();
}


// --------------------------------------------------
// List display
// --------------------------------------------------

const LIST_CONFIG = {
    borrow: {
        title: '貸出状況一覧 / Current Borrowed Items',
        api: '/api/borrow_list',
        headers: ['申請日時', '申請者', '物品名', '返却予定日'],
    },
    return: {
        title: '返却履歴一覧 / Returned Items History',
        api: '/api/return_list',
        headers: ['返却日時', '物品名', '返却者', '予定返却日'],
    },
    employee: {
        title: '登録社員一覧 / Registered Employees',
        api: '/api/employee_list',
        headers: ['氏名', 'Email'],
    },
    item: {
        title: '登録物品一覧 / Registered Items',
        api: '/api/item_list',
        headers: ['物品名', '現在の貸出者', '最終貸出日時'],
    },
    bug: {
        title: '不具合報告一覧 / Bug Reports',
        api: '/api/bug_list',
        headers: ['対応状況', '報告日時', '報告者', '不具合内容'],
    },
};

async function showList(type) {
    if (type === 'bug') {
        await showBugReport();
        return;
    }

    const config = LIST_CONFIG[type];
    document.getElementById('list-title').textContent = config.title;

    const thead = document.getElementById('table-header');
    thead.innerHTML = '<tr>' + config.headers.map(h => `<th>${h}</th>`).join('') + '</tr>';

    const data = await apiGet(config.api);
    const tbody = document.getElementById('table-body');

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="' + config.headers.length + '">データがありません</td></tr>';
    } else {
        tbody.innerHTML = data.map(row =>
            '<tr>' + row.map(cell => `<td>${cell}</td>`).join('') + '</tr>'
        ).join('');
    }

    switchView('list');
}


// --------------------------------------------------
// Bug report
// --------------------------------------------------

async function showBugReport() {
    const config = LIST_CONFIG.bug;

    const thead = document.getElementById('bug-table-header');
    thead.innerHTML = '<tr>' + config.headers.map(h => `<th>${h}</th>`).join('') + '</tr>';

    const data = await apiGet(config.api);
    const tbody = document.getElementById('bug-table-body');

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">報告なし</td></tr>';
    } else {
        tbody.innerHTML = data.map(row =>
            '<tr>' + row.map(cell => `<td>${cell}</td>`).join('') + '</tr>'
        ).join('');
    }

    document.getElementById('bug-reporter').value = '';
    document.getElementById('bug-description').value = '';

    switchView('bug-report');
}

async function submitBugReport() {
    const reporter = document.getElementById('bug-reporter').value;
    const description = document.getElementById('bug-description').value;

    if (!reporter || !description) {
        alert('名前と不具合内容を入力してください');
        return;
    }

    const result = await apiPost('/api/bug_report', { reporter, description });
    showResult(result.message);
}


// --------------------------------------------------
// Borrow / Return flow
// --------------------------------------------------

function startBorrow() {
    state.firstCard = null;
    state.secondCard = null;
    waitForNfc('1枚目のカードをタッチしてください<br><small>Please touch your first card</small>', handleFirstCard);
}

// NFC waiting via SSE
function waitForNfc(message, callback, ignoreIdm = null) {
    document.getElementById('nfc-prompt').innerHTML = message;
    nfcCallback = callback;
    nfcIgnoreIdm = ignoreIdm;
    switchView('nfc-wait');

    if (nfcEventSource) {
        nfcEventSource.close();
    }

    nfcEventSource = new EventSource('/api/nfc/stream');

    nfcEventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // Ignore same card as first scan (still on reader)
        if (nfcIgnoreIdm && data.idm === nfcIgnoreIdm) {
            return;
        }

        nfcEventSource.close();
        nfcEventSource = null;
        callback(data.idm);
    };

    nfcEventSource.onerror = () => {
        nfcEventSource.close();
        nfcEventSource = null;
    };
}

// First card handler
async function handleFirstCard(idm) {
    const card = await apiGet('/api/identify/' + encodeURIComponent(idm));

    if (card.type === 'employee') {
        state.firstCard = { type: 'employee', name: card.name, idm: idm };

        const borrowed = await apiGet('/api/employee/' + encodeURIComponent(card.name) + '/borrowed');
        if (borrowed.length > 0) {
            let msg = `<strong>${card.name}</strong>さんの借用中物品:<br>`;
            borrowed.forEach(item => {
                msg += `・${item.item_name}（返却予定: ${item.return_date}）<br>`;
            });
            msg += '<br>返却する場合は、初めに物品をタッチしてください。<br>追加で貸出登録しますか？';
            showConfirm(msg, () => {
                waitForNfc('借りる物品をタッチしてください<br><small>Please touch the item</small>', handleSecondCard, state.firstCard.idm);
            }, () => {
                switchView('main');
            });
        } else {
            waitForNfc(
                `社員証を確認: <strong>${card.name}</strong><br>借りる物品をタッチしてください<br><small>Please touch the item</small>`,
                handleSecondCard,
                state.firstCard.idm
            );
        }

    } else if (card.type === 'item') {
        state.firstCard = { type: 'item', name: card.name, idm: idm };

        const status = await apiGet('/api/item/' + encodeURIComponent(card.name) + '/status');
        if (status.borrowed) {
            showConfirm(
                `<strong>${card.name}</strong>は貸出中です。返却しますか？<br>` +
                `申請者: ${status.borrower}<br>返却予定日: ${status.return_date}`,
                async () => {
                    const result = await apiPost('/api/return', {
                        item_name: card.name,
                        borrower: status.borrower,
                        scheduled_date: status.return_date,
                    });
                    showResult(result.message);
                },
                () => {
                    switchView('main');
                }
            );
        } else {
            waitForNfc(
                `物品を確認: <strong>${card.name}</strong><br>社員証をタッチしてください<br><small>Please touch your employee card</small>`,
                handleSecondCard,
                state.firstCard.idm
            );
        }

    } else {
        state.unregisteredIdm = idm;
        switchView('register-select');
    }
}

// Second card handler
async function handleSecondCard(idm) {
    const card = await apiGet('/api/identify/' + encodeURIComponent(idm));

    if (state.firstCard.type === 'employee') {
        if (card.type === 'item') {
            const status = await apiGet('/api/item/' + encodeURIComponent(card.name) + '/status');
            if (status.borrowed) {
                showConfirm(
                    `<strong>${card.name}</strong>は貸出中です。返却しますか？<br>` +
                    `申請者: ${status.borrower}<br>返却予定日: ${status.return_date}`,
                    async () => {
                        const result = await apiPost('/api/return', {
                            item_name: card.name,
                            borrower: status.borrower,
                            scheduled_date: status.return_date,
                        });
                        showResult(result.message);
                    },
                    () => { switchView('main'); }
                );
                return;
            }
            state.secondCard = { type: 'item', name: card.name, idm: idm };
            switchView('calendar');
        } else if (card.type === 'employee') {
            alert('社員証がタッチされました。物品をタッチしてください。');
            waitForNfc('物品をタッチしてください<br><small>Please touch the item</small>', handleSecondCard, state.firstCard.idm);
        } else {
            state.unregisteredIdm = idm;
            switchView('register-select');
        }

    } else if (state.firstCard.type === 'item') {
        if (card.type === 'employee') {
            state.secondCard = { type: 'employee', name: card.name, idm: idm };
            switchView('calendar');
        } else if (card.type === 'item') {
            alert('物品がタッチされました。社員証をタッチしてください。');
            waitForNfc('社員証をタッチしてください<br><small>Please touch your employee card</small>', handleSecondCard, state.firstCard.idm);
        } else {
            state.unregisteredIdm = idm;
            switchView('register-select');
        }
    }
}


// --------------------------------------------------
// Confirm dialog
// --------------------------------------------------

function showConfirm(message, onYes, onNo) {
    document.getElementById('confirm-message').innerHTML = message;
    confirmYesCallback = onYes;
    confirmNoCallback = onNo;
    switchView('confirm');
}

function onConfirmYes() {
    if (confirmYesCallback) confirmYesCallback();
}

function onConfirmNo() {
    if (confirmNoCallback) confirmNoCallback();
}


// --------------------------------------------------
// Date selection
// --------------------------------------------------

function openDatePicker() {
    const picker = document.getElementById('date-picker');
    picker.style.display = 'block';
    picker.focus();
    picker.showPicker();
    picker.onchange = () => {
        selectDate('custom');
        picker.style.display = 'none';
    };
}

async function selectDate(type) {
    let date;
    const today = new Date();

    if (type === 'today') {
        date = formatDate(today);
    } else if (type === 'tomorrow') {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        date = formatDate(tomorrow);
    } else {
        date = document.getElementById('date-picker').value;
        if (!date) {
            alert('日付を選択してください');
            return;
        }
    }

    const employeeName = state.firstCard.type === 'employee'
        ? state.firstCard.name
        : state.secondCard.name;
    const itemName = state.firstCard.type === 'item'
        ? state.firstCard.name
        : state.secondCard.name;

    const result = await apiPost('/api/borrow', {
        employee_name: employeeName,
        item_name: itemName,
        return_date: date,
    });

    showResult(result.message);
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}


// --------------------------------------------------
// Registration
// --------------------------------------------------

function showRegisterForm(type) {
    if (type === 'employee') {
        document.getElementById('reg-emp-idm').textContent = state.unregisteredIdm;
        document.getElementById('reg-emp-name').value = '';
        document.getElementById('reg-emp-email').value = '';
        switchView('register-employee');
    } else {
        document.getElementById('reg-item-idm').textContent = state.unregisteredIdm;
        document.getElementById('reg-item-name').value = '';
        switchView('register-item');
    }
}

async function submitRegisterEmployee() {
    const name = document.getElementById('reg-emp-name').value;
    const email = document.getElementById('reg-emp-email').value;
    if (!name || !email) {
        alert('氏名とメールアドレスを入力してください');
        return;
    }
    const result = await apiPost('/api/register/employee', {
        idm: state.unregisteredIdm,
        name: name,
        email: email,
    });
    showResult(result.message);
}

async function submitRegisterItem() {
    const itemName = document.getElementById('reg-item-name').value;
    if (!itemName) {
        alert('物品名を入力してください');
        return;
    }
    const result = await apiPost('/api/register/item', {
        idm: state.unregisteredIdm,
        item_name: itemName,
    });
    showResult(result.message);
}


// --------------------------------------------------
// Result display
// --------------------------------------------------

function showResult(message) {
    document.getElementById('result-message').textContent = message;
    switchView('result');
}


// --------------------------------------------------
// Keyboard navigation (Arrow keys + Enter)
// --------------------------------------------------

document.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    const activeTag = activeEl.tagName;
    const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
    const isDatePicker = activeTag === 'INPUT' && activeEl.type === 'date';
    const isTableScroll = activeEl.classList.contains('table-scroll');

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (isDatePicker) return;
        if (isTableScroll) {
            e.preventDefault();
            activeEl.scrollBy(0, e.key === 'ArrowDown' ? 60 : -60);
            return;
        }
        e.preventDefault();
        moveFocus(e.key === 'ArrowDown' ? 1 : -1);
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (isDatePicker) return;
        if (isTableScroll) {
            e.preventDefault();
            moveFocus(e.key === 'ArrowRight' ? 1 : -1);
            return;
        }
        e.preventDefault();
        moveFocus(e.key === 'ArrowRight' ? 1 : -1);
    }

    if (e.key === 'Enter') {
        if (isTyping && !isDatePicker) {
            e.preventDefault();
            moveFocus(1);
            return;
        }

        e.preventDefault();
        const focused = document.activeElement;
        if (focused && focused.tagName === 'BUTTON') {
            focused.click();
        }
    }

    if (e.key === 'Escape') {
        switchView('main');
    }
});

function moveFocus(direction) {
    const activeView = document.querySelector('.view.active');
    if (!activeView) return;

    const focusable = Array.from(
        activeView.querySelectorAll('button, input, textarea, select, [tabindex]')
    ).filter(el => !el.disabled && el.offsetParent !== null);

    if (focusable.length === 0) return;

    const currentIndex = focusable.indexOf(document.activeElement);

    let nextIndex;
    if (currentIndex === -1) {
        nextIndex = 0;
    } else {
        nextIndex = (currentIndex + direction + focusable.length) % focusable.length;
    }

    focusable[nextIndex].focus();
}

// Auto-focus first element when view changes
const observer = new MutationObserver(() => {
    const activeView = document.querySelector('.view.active');
    if (activeView) {
        const firstFocusable = activeView.querySelector('button, input, textarea');
        if (firstFocusable) {
            setTimeout(() => firstFocusable.focus(), 50);
        }
    }
});

observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
});
