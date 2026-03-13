/*
 * Equipment Manager - フロントエンド
 *
 * 状態機械（State Machine）で画面遷移を管理する。
 * 現行GUIコードの current_view と同じ考え方。
 */

// --- 状態管理 ---
// 貸出フロー中に「1枚目のカード」「2枚目のカード」の情報を保持する
const state = {
    firstCard: null,   // { type: "employee"|"item", name: "...", idm: "..." }
    secondCard: null,
    unregisteredIdm: null,
};


// --------------------------------------------------
// 画面切り替え（現行コードの return_to_main() に相当）
// --------------------------------------------------

function switchView(viewName) {
    // NFC待機画面から離れるときはSSE接続を閉じる
    if (nfcEventSource && viewName !== 'nfc-wait') {
        nfcEventSource.close();
        nfcEventSource = null;
    }

    // 全画面から active を外す
    document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active');
    });
    // 指定した画面に active を付ける
    document.getElementById('view-' + viewName).classList.add('active');
}


// --------------------------------------------------
// API呼び出しのヘルパー関数
// --------------------------------------------------

// GETリクエスト（データ取得用）
async function apiGet(url) {
    const response = await fetch(url);
    return response.json();
}

// POSTリクエスト（データ送信用）
async function apiPost(url, data) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return response.json();
}


// --------------------------------------------------
// 一覧表示
// --------------------------------------------------

// テーブルのヘッダーと対応するAPIのマッピング
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
    // 不具合報告は専用画面を使う（フォーム付きなので）
    if (type === 'bug') {
        await showBugReport();
        return;
    }

    const config = LIST_CONFIG[type];
    document.getElementById('list-title').textContent = config.title;

    // ヘッダーを作る
    const thead = document.getElementById('table-header');
    thead.innerHTML = '<tr>' + config.headers.map(h => `<th>${h}</th>`).join('') + '</tr>';

    // APIからデータを取得してテーブルに表示
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

// 不具合報告画面（テーブル + フォーム）
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

    // フォームをクリア
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
// 貸出/返却フロー
//
// 現行コードのフローをそのまま再現:
// 1. カードタッチ → 社員 or 物品 を判定
// 2. 社員なら「物品をタッチ」、物品なら「社員証をタッチ」
// 3. 返却日を選んで貸出記録
//
// ※ Phase 2 で NFC の SSE を実装するまでは、
//   手動でIDmを入力するテスト用UIを使う
// --------------------------------------------------

function startBorrow() {
    state.firstCard = null;
    state.secondCard = null;
    waitForNfc('1枚目のカードをタッチしてください<br><small>Please touch your first card</small>', handleFirstCard);
}

// --------------------------------------------------
// NFC待機（SSE で実際のNFCリーダーからイベントを受信する）
//
// 流れ:
//   1. waitForNfc() が呼ばれる
//   2. SSE接続を開く（/api/nfc/stream）
//   3. NFCリーダーがカードを検出するまで待つ
//   4. カードが検出されたら callback を呼ぶ
//   5. SSE接続を閉じる
// --------------------------------------------------

let nfcCallback = null;
let nfcEventSource = null;  // SSE接続を保持する変数
let nfcIgnoreIdm = null;    // この IDm は無視する（1枚目と同じカードの再検知防止）

function waitForNfc(message, callback, ignoreIdm = null) {
    document.getElementById('nfc-prompt').innerHTML = message;
    nfcCallback = callback;
    nfcIgnoreIdm = ignoreIdm;
    switchView('nfc-wait');

    // 前の接続が残っていたら閉じる
    if (nfcEventSource) {
        nfcEventSource.close();
    }

    // SSE接続を開く
    nfcEventSource = new EventSource('/api/nfc/stream');

    // カードが検出されたとき（サーバーからイベントが来たとき）
    nfcEventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // 1枚目と同じカードならスルーする（まだリーダー上にある場合）
        if (nfcIgnoreIdm && data.idm === nfcIgnoreIdm) {
            return;  // 無視して次のイベントを待つ
        }

        // 接続を閉じる（1回読み取ったら終了）
        nfcEventSource.close();
        nfcEventSource = null;
        // コールバックを呼ぶ
        callback(data.idm);
    };

    // エラー時（接続が切れた等）
    nfcEventSource.onerror = () => {
        nfcEventSource.close();
        nfcEventSource = null;
    };
}


// 1枚目のカード処理
async function handleFirstCard(idm) {
    const card = await apiGet('/api/identify/' + encodeURIComponent(idm));

    if (card.type === 'employee') {
        state.firstCard = { type: 'employee', name: card.name, idm: idm };

        // この社員が借りている物品があるか確認
        const borrowed = await apiGet('/api/employee/' + encodeURIComponent(card.name) + '/borrowed');
        if (borrowed.length > 0) {
            let msg = `<strong>${card.name}</strong>さんの借用中物品:<br>`;
            borrowed.forEach(item => {
                msg += `・${item.item_name}（返却予定: ${item.return_date}）<br>`;
            });
            msg += '<br>返却する場合は、初めに物品をタッチしてください。<br>追加で貸出登録しますか？';
            showConfirm(msg, () => {
                // 「はい」→ 物品のNFC待機へ
                waitForNfc('借りる物品をタッチしてください<br><small>Please touch the item</small>', handleSecondCard, state.firstCard.idm);
            }, () => {
                // 「いいえ」→ メインに戻る
                switchView('main');
            });
        } else {
            waitForNfc(
                `社員証を確認: <strong>${card.name}</strong><br>借りる物品をタッチしてください<br><small>Please touch the item</small>`,
                handleSecondCard,
                state.firstCard.idm  // 1枚目のIDmを無視する
            );
        }

    } else if (card.type === 'item') {
        state.firstCard = { type: 'item', name: card.name, idm: idm };

        // この物品が貸出中か確認
        const status = await apiGet('/api/item/' + encodeURIComponent(card.name) + '/status');
        if (status.borrowed) {
            showConfirm(
                `<strong>${card.name}</strong>は貸出中です。返却しますか？<br>` +
                `申請者: ${status.borrower}<br>返却予定日: ${status.return_date}`,
                async () => {
                    // 「はい」→ 返却処理
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
                state.firstCard.idm  // 1枚目のIDmを無視する
            );
        }

    } else {
        // 未登録
        state.unregisteredIdm = idm;
        switchView('register-select');
    }
}

// 2枚目のカード処理
async function handleSecondCard(idm) {
    const card = await apiGet('/api/identify/' + encodeURIComponent(idm));

    // 1枚目が社員なら、2枚目は物品でないとダメ
    if (state.firstCard.type === 'employee') {
        if (card.type === 'item') {
            // 物品が貸出中か確認
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

    // 1枚目が物品なら、2枚目は社員でないとダメ
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
// 確認ダイアログ
// --------------------------------------------------

let confirmYesCallback = null;
let confirmNoCallback = null;

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
// 返却日選択
// --------------------------------------------------

// カレンダーボタンを押したら非表示のdate inputを開く
function openDatePicker() {
    const picker = document.getElementById('date-picker');
    picker.style.display = 'block';
    picker.focus();
    picker.showPicker();  // ブラウザのカレンダーUIを表示
    // 日付が選ばれたら自動で登録
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

    // 社員名と物品名を state から取得
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
// 登録処理
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
// 結果表示
// --------------------------------------------------

function showResult(message) {
    document.getElementById('result-message').textContent = message;
    switchView('result');
}


// --------------------------------------------------
// キーボードナビゲーション（矢印キー + Enter）
//
// 現行GUIの handle_common_events() と同じ考え方。
// 今表示されている画面のボタン/入力欄を矢印キーで移動し、
// Enter で「クリック」する。
//
// 仕組み:
//   1. 現在の画面内のフォーカス可能な要素を取得
//   2. 矢印キーで次/前の要素にフォーカスを移動
//   3. Enter でフォーカス中の要素をクリック
//   4. フォーカス中の要素を視覚的にハイライト（CSS）
// --------------------------------------------------

document.addEventListener('keydown', (e) => {
    // テキスト入力中・日付選択中は矢印キーを通常動作させる
    const activeEl = document.activeElement;
    const activeTag = activeEl.tagName;
    const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
    const isDatePicker = activeTag === 'INPUT' && activeEl.type === 'date';

    // テーブルスクロール領域にフォーカスがあるときは矢印でスクロール
    const isTableScroll = activeEl.classList.contains('table-scroll');

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (isDatePicker) return;
        if (isTableScroll) {
            // テーブル内を上下スクロール
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
            // テーブルから抜けて前後のボタンへ移動
            e.preventDefault();
            moveFocus(e.key === 'ArrowRight' ? 1 : -1);
            return;
        }
        e.preventDefault();
        moveFocus(e.key === 'ArrowRight' ? 1 : -1);
    }

    if (e.key === 'Enter') {
        // 入力欄にいるときは次の要素にフォーカスを移動
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

    // Escapeでメインに戻る
    if (e.key === 'Escape') {
        switchView('main');
    }
});

function moveFocus(direction) {
    // 現在表示されている画面を取得
    const activeView = document.querySelector('.view.active');
    if (!activeView) return;

    // その画面内のフォーカス可能な要素を取得
    const focusable = Array.from(
        activeView.querySelectorAll('button, input, textarea, select, [tabindex]')
    ).filter(el => !el.disabled && el.offsetParent !== null);

    if (focusable.length === 0) return;

    // 現在フォーカスされている要素のインデックスを探す
    const currentIndex = focusable.indexOf(document.activeElement);

    // 次のインデックスを計算（ループする）
    let nextIndex;
    if (currentIndex === -1) {
        // どこにもフォーカスがなければ最初の要素へ
        nextIndex = 0;
    } else {
        nextIndex = (currentIndex + direction + focusable.length) % focusable.length;
    }

    focusable[nextIndex].focus();
}

// 画面切り替え時に最初の要素にフォーカスを当てる
// switchView を拡張
const _originalSwitchView = switchView;
// 注意: switchView は const ではなく function 宣言なので上書きできない
// 代わりに MutationObserver でクラス変更を監視する

// 画面が切り替わったら最初のボタンにフォーカスする
const observer = new MutationObserver(() => {
    const activeView = document.querySelector('.view.active');
    if (activeView) {
        const firstFocusable = activeView.querySelector('button, input, textarea');
        if (firstFocusable) {
            // 少し遅らせてDOMの更新を待つ
            setTimeout(() => firstFocusable.focus(), 50);
        }
    }
});

// body の子要素のクラス変更を監視する
observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
});
