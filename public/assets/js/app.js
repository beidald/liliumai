import translations, { configMeta } from '../../i18n.js';

// Helper for Syntax Highlighting and Copy Button
function highlightAndCopy(container) {
    // Highlight
    if (window.hljs) {
        container.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }

    // Copy Button
    container.querySelectorAll('pre').forEach((pre) => {
        if (pre.querySelector('.copy-btn')) return;

        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.innerHTML = '<i class="fas fa-copy"></i>';
        btn.onclick = () => {
            const code = pre.querySelector('code').innerText;
            navigator.clipboard.writeText(code).then(() => {
                btn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => btn.innerHTML = '<i class="fas fa-copy"></i>', 2000);
            });
        };
        pre.appendChild(btn);
    });
}

// --- Auth Logic ---
const loginModal = document.getElementById('login-modal');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

window.showLogin = () => {
    if (loginModal) loginModal.classList.add('visible');
};

window.hideLogin = () => {
    if (loginModal) loginModal.classList.remove('visible');
    if (loginError) loginError.style.display = 'none';
};

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (res.ok && data.status === 'ok') {
            localStorage.setItem('admin_token', data.token);
            window.hideLogin();
            updateAuthUI(true);
            // Reload config and data
            if (window.refreshConfig) window.refreshConfig(); 
            loadHistory();
            loadSessions();
        } else {
            loginError.textContent = data.error || 'Login failed';
            loginError.style.display = 'block';
        }
    } catch (err) {
        loginError.textContent = 'Network error';
        loginError.style.display = 'block';
    }
});

function updateAuthUI(isLoggedIn) {
    const userMenu = document.getElementById('user-menu-container');
    const loginBtn = document.getElementById('login-btn-header');
    
    if (isLoggedIn) {
        if (userMenu) userMenu.classList.remove('hidden');
        if (loginBtn) loginBtn.classList.add('hidden');
    } else {
        if (userMenu) userMenu.classList.add('hidden');
        if (loginBtn) loginBtn.classList.remove('hidden');
    }
}

function checkAuth() {
    const token = localStorage.getItem('admin_token');
    
    // Initial UI State based on token presence
    if (token) {
        updateAuthUI(true);
    } else {
        updateAuthUI(false);
        // Only show login modal if user expects it, or just let them click the button.
        // User asked for "Login icon" which implies they can click it.
        // If I force modal, the icon is less useful.
        // I'll remove the auto-show login modal on page load, unless they try to chat.
        // But for now, let's just update UI and NOT force modal, so they see the "Logged Out" state properly.
        return;
    }

    // Proactively check auth by trying to fetch config
    fetch('/api/config', {
        headers: { 'Authorization': `Bearer ${token}` }
    }).then(res => {
        if (res.status === 401 || res.status === 403) {
            localStorage.removeItem('admin_token'); // Ensure clean state
            updateAuthUI(false);
            showLogin();
        } else {
            // Token is valid, fetch user info
            updateAuthUI(true);
            fetch('/api/me', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            .then(r => r.json())
            .then(user => {
                if (user && user.username) {
                    updateUserMenu(user);
                }
            })
            .catch(e => console.error('Failed to fetch user info', e));
        }
    }).catch(() => {
        // Network error - keep UI as logged in (optimistic) or show error
    });
}

function updateUserMenu(user) {
    const avatarEl = document.getElementById('user-avatar');
    const nameEl = document.getElementById('user-name');
    const roleEl = document.getElementById('user-role');
    
    if (avatarEl) avatarEl.textContent = (user.username || 'A').charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = user.username || 'Admin';
    if (roleEl) roleEl.textContent = user.role || 'admin';
}

// --- User Menu & Password Change ---
window.showChangePassword = () => {
    const modal = document.getElementById('password-modal');
    if (!modal) return;
    
    modal.classList.remove('hidden');
    // Trigger reflow for transition
    void modal.offsetWidth;
    modal.classList.remove('opacity-0');
    modal.querySelector('div').classList.remove('scale-95');
    
    // Clear form
    const form = document.getElementById('password-form');
    if (form) form.reset();
    const err = document.getElementById('password-error');
    if (err) err.style.display = 'none';
};

window.hideChangePassword = () => {
    const modal = document.getElementById('password-modal');
    if (!modal) return;
    
    modal.classList.add('opacity-0');
    modal.querySelector('div').classList.add('scale-95');
    
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
};

window.logout = () => {
    localStorage.removeItem('admin_token');
    window.location.reload();
};

// Password Form Handler
const passwordForm = document.getElementById('password-form');
if (passwordForm) {
    passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const oldPassword = document.getElementById('old-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        const errorEl = document.getElementById('password-error');
        
        // Simple client-side validation
        if (newPassword !== confirmPassword) {
            errorEl.textContent = "New passwords do not match"; // Fallback if no translation
            // Try to use translation if available
            if (typeof translations !== 'undefined' && typeof currentLang !== 'undefined' && translations[currentLang]) {
                 // We might need to add this key to translations if not present, but for now use English fallback
            }
            errorEl.style.display = 'block';
            return;
        }
        
        try {
            const res = await fetch('/api/change-password', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
                },
                body: JSON.stringify({ oldPassword, newPassword })
            });
            
            const data = await res.json();
            
            if (res.ok) {
                const t = (typeof translations !== 'undefined' && typeof currentLang !== 'undefined') ? translations[currentLang] : {};
                alert(t.passwordChanged || 'Password changed successfully');
                window.hideChangePassword();
            } else {
                const t = (typeof translations !== 'undefined' && typeof currentLang !== 'undefined') ? translations[currentLang] : {};
                errorEl.textContent = data.error || (t.passwordChangeError || 'Failed to change password');
                errorEl.style.display = 'block';
            }
        } catch (err) {
            errorEl.textContent = 'Network error';
            errorEl.style.display = 'block';
        }
    });
}

// Global fetch interceptor to handle 401s
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const token = localStorage.getItem('admin_token');
    if (token) {
        let [resource, config] = args;
        if (!config) {
            config = {};
        }
        if (!config.headers) {
            config.headers = {};
        }
        if (!config.headers['Authorization']) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        args[1] = config;
    }

    const response = await originalFetch.apply(this, args);
    
    if (response.status === 401) {
        showLogin();
    }
    
    return response;
};

// Initial Auth Check
checkAuth();

let currentLang = localStorage.getItem('lang') || 'zh';
let isThinking = false;

// Generate or retrieve stable session ID
let sessionId = localStorage.getItem('sessionId');
let currentThreadId = localStorage.getItem('currentThreadId');

// Ensure sessionId always starts with 'sess_' if it's not a wechat id (which starts with 'wechat_')
// But the user complained about 'wechat_' prefix appearing without logging in.
// This happens if the user previously logged in, the id was saved in localStorage, and they refreshed.
// Or if the backend sent a login_success event for ANOTHER user (if logic was buggy).
// To be safe, if the user is not explicitly in "WeChat mode", we should probably default to "sess_".
// However, if we reset it, they lose access to their WeChat history.
// The user's concern is specifically about NEW tasks getting 'wechat_' prefix when they are just using web.
// This means we need to decouple the "login session" from the "web chat identity" OR fix the assumption.

// For now, we keep the initialization, but we will strictly control when 'wechat_' is used.
if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('sessionId', sessionId);
} else {
    // Check if we have a stale wechat session that shouldn't be there?
    // The user says "didn't login wechat", so if sessionId is 'wechat_...', it's wrong for them.
    // FIX: If user explicitly claims they are not logged in but has a wechat_ ID, we reset it.
    // We assume that if the page loads fresh and has a wechat_ ID, it MIGHT be stale unless confirmed.
    // However, destroying valid sessions is bad.
    // But since the user wants to solve the issue of "using wechat id without login", we add a check:
    // If sessionId starts with 'wechat_', we will append a flag or handle it.
    // For now, we will just regenerate if it is a wechat session to satisfy the user request for a clean state.
    // This is a "hard reset" for the specific issue.
    if (sessionId.startsWith('wechat_')) {
        console.log('Detected stale WeChat session ID without explicit login confirmation. Resetting to Web session.');
        sessionId = 'sess_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('sessionId', sessionId);
    }
}

if (!currentThreadId) {
    currentThreadId = 'thread_' + Date.now();
    localStorage.setItem('currentThreadId', currentThreadId);
}

// IMPORTANT: When connecting, we use the sessionId.
// If sessionId is 'wechat_...', the backend treats it as a WeChat-linked session.
// If the user wants to be "pure web", they should clear their session or we provide a logout.
const socket = io({
    query: { sessionId: `${sessionId}:${currentThreadId}` }
});

// DOM Elements
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const messagesDiv = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');
const configPanel = document.getElementById('config-panel');
const configOverlay = document.getElementById('config-overlay');
const tasksModal = document.getElementById('tasks-modal');
const tasksModalContent = document.getElementById('tasks-modal-content');
const qrModal = document.getElementById('qr-modal');
const qrContainer = document.getElementById('qr-container');
const qrStatus = document.getElementById('qr-status');
const wechatLoginBtn = document.getElementById('wechat-login-btn');

if (wechatLoginBtn) {
    wechatLoginBtn.onclick = () => {
        qrModal.classList.remove('hidden');
        // Optional: Stop animation when opened
        wechatLoginBtn.classList.remove('animate-pulse');
        wechatLoginBtn.querySelector('span')?.classList.remove('animate-bounce');
    };
}
const sessionList = document.getElementById('session-list');
const currentChatTitle = document.getElementById('current-chat-title');

// i18n initialization
function updateUIStrings() {
    const t = translations[currentLang];
    document.title = t.title;
    const titleEl = document.getElementById('i18n-title');
    if (titleEl) titleEl.textContent = t.title;
    
    const settingsTitleEl = document.getElementById('i18n-settings-title');
    if (settingsTitleEl) settingsTitleEl.textContent = t.settings;
    
    const refreshBtnEl = document.getElementById('i18n-refresh-btn');
    if (refreshBtnEl) refreshBtnEl.textContent = t.refresh;

    const saveBtnEl = document.getElementById('i18n-save-btn');
    if (saveBtnEl) saveBtnEl.textContent = t.save;
    
    const scanTitleEl = document.getElementById('i18n-scan-title');
    if (scanTitleEl) scanTitleEl.textContent = t.scanToLogin;
    
    const closeBtnEl = document.getElementById('i18n-close-btn');
    if (closeBtnEl) closeBtnEl.textContent = t.close;
    
    const welcomeTitleEl = document.getElementById('i18n-welcome-title');
    if (welcomeTitleEl) welcomeTitleEl.textContent = t.welcomeTitle;
    
    const welcomeDescEl = document.getElementById('i18n-welcome-desc');
    if (welcomeDescEl) welcomeDescEl.textContent = t.welcomeDesc;

    if (messageInput) {
        messageInput.placeholder = t.typePlaceholder;
    }

    // Login Modal
    const loginTitleEl = document.getElementById('i18n-login-title');
    if (loginTitleEl) loginTitleEl.textContent = t.loginTitle;

    const loginDescEl = document.getElementById('i18n-login-desc');
    if (loginDescEl) loginDescEl.textContent = t.loginDesc;

    const loginBtnEl = document.getElementById('i18n-login-btn');
    if (loginBtnEl) loginBtnEl.textContent = t.loginBtn;

    const emailInput = document.getElementById('email');
    if (emailInput) emailInput.placeholder = t.loginEmailPlaceholder;

    const passwordInput = document.getElementById('password');
    if (passwordInput) passwordInput.placeholder = t.loginPasswordPlaceholder;

    // Disclaimer
    const disclaimerEl = document.getElementById('i18n-disclaimer');
    if (disclaimerEl) disclaimerEl.textContent = t.disclaimer;

    // Tasks Modal
    const tasksTitleEl = document.getElementById('i18n-tasks-title');
    if (tasksTitleEl) tasksTitleEl.textContent = t.tasks;
    
    const tasksSubtitleEl = document.getElementById('i18n-tasks-subtitle');
    if (tasksSubtitleEl) tasksSubtitleEl.textContent = t.tasksSubtitle;

    const refreshTasksBtnEl = document.getElementById('i18n-refresh-tasks-btn');
    if (refreshTasksBtnEl) refreshTasksBtnEl.innerHTML = `<i class="fas fa-sync-alt"></i> <span>${t.refreshTasks}</span>`;

    const tabAll = document.getElementById('i18n-tab-all');
    if (tabAll) tabAll.textContent = t.taskStatusAll;
    
    const tabPending = document.getElementById('i18n-tab-pending');
    if (tabPending) tabPending.textContent = t.taskStatusPending;
    
    const tabInProgress = document.getElementById('i18n-tab-inprogress');
    if (tabInProgress) tabInProgress.textContent = t.taskStatusInProgress;
    
    const tabPaused = document.getElementById('i18n-tab-paused');
    if (tabPaused) tabPaused.textContent = t.taskStatusPaused;

    const tabCompleted = document.getElementById('i18n-tab-completed');
    if (tabCompleted) tabCompleted.textContent = t.taskStatusCompleted;
    
    const tabFailed = document.getElementById('i18n-tab-failed');
    if (tabFailed) tabFailed.textContent = t.taskStatusFailed;

    // Handle all data-i18n elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) {
            el.textContent = t[key];
        }
    });

    const thinkingText = document.querySelector('.i18n-thinking');
    if (thinkingText) {
        thinkingText.textContent = currentLang === 'zh' ? 'Nanobot 正在思考...' : 'Nanobot is thinking...';
    }

    const newChatBtn = document.querySelector('button[onclick="createNewChat()"]');
    if (newChatBtn) {
        newChatBtn.innerHTML = `<i class="fas fa-plus"></i> ${t.newChat}`;
    }
    
    // Update Tasks/Settings button titles
    const btnTasksToggle = document.getElementById('btn-tasks-toggle');
    if (btnTasksToggle) btnTasksToggle.title = t.tasks || 'Tasks';
    
    const btnSettingsToggle = document.getElementById('btn-settings-toggle');
    if (btnSettingsToggle) btnSettingsToggle.title = t.settings || 'Settings';
    
    // Update language switcher UI
    document.getElementById('lang-zh').className = `flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${currentLang === 'zh' ? 'bg-white shadow-sm text-blue-600 border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`;
    document.getElementById('lang-en').className = `flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${currentLang === 'en' ? 'bg-white shadow-sm text-blue-600 border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`;
    
    updateStatusUI();
    loadSessions();
}

let currentSessionChannel = 'web'; // 'web' or 'wechat'

let isWebChatsExpanded = true;
let isWechatChatsExpanded = false;

async function loadSessions() {
    const token = localStorage.getItem('admin_token');
    
    let webSessions = [];
    let wechatSessions = [];

    if (token) {
        try {
            // Load Web Sessions
            const webRes = await fetch(`/api/sessions?userPrefix=${sessionId}&type=web`);
            if (webRes.ok) webSessions = await webRes.json();
            
            // Load WeChat Sessions
            const wechatRes = await fetch(`/api/sessions?type=wechat`);
            if (wechatRes.ok) wechatSessions = await wechatRes.json();
        } catch (err) {
            console.error('Failed to load sessions:', err);
        }
    }

    sessionList.innerHTML = '';
    const t = translations[currentLang];
    
    // Render Web Sessions
    const webTitle = document.createElement('div');
    webTitle.className = 'px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2 cursor-pointer hover:bg-slate-50 rounded-lg select-none';
    webTitle.onclick = () => {
        isWebChatsExpanded = !isWebChatsExpanded;
        loadSessions();
    };
    webTitle.innerHTML = `
        <i class="fas fa-chevron-right transition-transform duration-200 ${isWebChatsExpanded ? 'rotate-90' : ''} text-[10px]"></i>
        <i class="fas fa-laptop"></i> 
        <span>${t.webChats}</span>
    `;
    sessionList.appendChild(webTitle);

    const webContainer = document.createElement('div');
    webContainer.className = `space-y-1 transition-all duration-200 overflow-hidden ${isWebChatsExpanded ? 'opacity-100 max-h-[1000px]' : 'opacity-0 max-h-0'}`;
    
    if (webSessions.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'px-3 py-2 text-sm text-slate-400 italic pl-8';
            empty.textContent = token ? t.noWebChats : (currentLang === 'zh' ? '请登录查看历史会话' : 'Please login to view history');
            webContainer.appendChild(empty);
    } else {
        webSessions.forEach(s => {
            const item = renderSessionItem(s, 'web');
            webContainer.appendChild(item);
        });
    }
    sessionList.appendChild(webContainer);
    
    // Render WeChat Sessions
    const separator = document.createElement('div');
    separator.className = 'h-px bg-slate-100 my-2 mx-2';
    sessionList.appendChild(separator);
    
    const wechatTitle = document.createElement('div');
    wechatTitle.className = 'px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2 cursor-pointer hover:bg-slate-50 rounded-lg select-none';
    wechatTitle.onclick = () => {
        isWechatChatsExpanded = !isWechatChatsExpanded;
        loadSessions();
    };
    wechatTitle.innerHTML = `
        <i class="fas fa-chevron-right transition-transform duration-200 ${isWechatChatsExpanded ? 'rotate-90' : ''} text-[10px]"></i>
        <i class="fab fa-weixin"></i> 
        <span>${t.wechatMessages}</span>
    `;
    sessionList.appendChild(wechatTitle);

    const wechatContainer = document.createElement('div');
    wechatContainer.className = `space-y-1 transition-all duration-200 overflow-hidden ${isWechatChatsExpanded ? 'opacity-100 max-h-[1000px]' : 'opacity-0 max-h-0'}`;
    
    if (wechatSessions.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'px-3 py-2 text-sm text-slate-400 italic pl-8';
            empty.textContent = token ? t.noWechatMessages : (currentLang === 'zh' ? '请登录查看历史会话' : 'Please login to view history');
            wechatContainer.appendChild(empty);
    } else {
        wechatSessions.forEach(s => {
            const item = renderSessionItem(s, 'wechat');
            wechatContainer.appendChild(item);
        });
    }
    sessionList.appendChild(wechatContainer);
    
    if (webSessions.length === 0 && wechatSessions.length === 0) {
        // Only reset title if we are truly empty (usually initial load)
        // currentChatTitle.textContent = t.newChat;
        // showWelcome();
    }
}

function renderSessionItem(s, type) {
    // ID parsing logic
    let displayId, fullId;
    if (type === 'web') {
        const parts = s.id.split(':');
        displayId = parts.length >= 3 ? parts[2] : (parts.length > 1 ? parts[1] : s.id);
        fullId = s.id; // Currently web sessions from API don't have 'web:' prefix (stripped in backend)
    } else {
        // WeChat sessions come as 'wechat:contactId'
        fullId = s.id;
        displayId = s.id; // For WeChat, use the full ID for switching
    }

    const isWeb = type === 'web';
    // Determine if active: 
    // For web: currentThreadId matches the thread part
    // For wechat: currentThreadId matches the full ID (wechat:...)
    const isActive = isWeb ? (displayId === currentThreadId && currentSessionChannel === 'web') 
                            : (fullId === currentThreadId && currentSessionChannel === 'wechat');
    
    const item = document.createElement('div');
    item.className = `group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${isActive ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`;
    item.onclick = () => switchSession(isWeb ? displayId : fullId, type);
    
    const iconClass = isWeb ? 'fa-message' : 'fa-user-circle';
    const title = s.title || (isWeb ? 'New Chat' : 'Unknown User');
    
    item.innerHTML = `
        <div class="flex items-center gap-3 overflow-hidden">
            <i class="fas ${iconClass} text-sm ${isActive ? 'text-blue-500' : 'text-slate-400'}"></i>
            <span class="truncate font-medium text-sm">${title}</span>
        </div>
        <button onclick="event.stopPropagation(); deleteSession('${isWeb ? displayId : fullId}', '${type}')" class="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 hover:text-red-500 rounded-lg transition-all">
            <i class="fas fa-trash-can text-xs"></i>
        </button>
    `;
    // Removed: sessionList.appendChild(item); - now handled by caller
    
    if (isActive) {
        currentChatTitle.textContent = title;
    }
    return item;
}

function showWelcome() {
    messagesDiv.innerHTML = `
        <div id="welcome-message" class="max-w-3xl mx-auto text-center py-12 space-y-6">
            <div class="w-20 h-20 bg-blue-50 text-blue-600 rounded-[2rem] flex items-center justify-center mx-auto text-3xl shadow-inner">
                <i class="fas fa-robot"></i>
            </div>
            <div class="space-y-2">
                <h3 class="text-3xl font-black text-slate-800">${translations[currentLang].welcomeTitle}</h3>
                <p class="text-slate-500 max-w-sm mx-auto font-medium">${translations[currentLang].welcomeDesc}</p>
            </div>
        </div>
    `;
}

window.switchSession = async (id, type = 'web') => {
    // Determine new Thread ID
    let newThreadId = id;
    if (type === 'web') {
        // If it's a web session, we might be passed just the thread ID part
        // We need to ensure we don't re-trigger if it's the same
        if (currentThreadId === id && currentSessionChannel === 'web') return;
        newThreadId = id;
    } else {
        // WeChat session
        if (currentThreadId === id && currentSessionChannel === 'wechat') return;
        newThreadId = id;
    }
    
    currentThreadId = newThreadId;
    currentSessionChannel = type;
    
    // Only save to localStorage if it's a web session (to resume state)
    if (type === 'web') {
        localStorage.setItem('currentThreadId', currentThreadId);
    }
    
    // Notify server about session change (for socket room joining?)
    // If it's a web session, we join the session ID room.
    // If it's wechat, we might not need to join a socket room unless we want real-time updates from that wechat user.
    // But currently the backend only joins 'sessionId' from handshake query.
    // For now, we update session mainly to reset UI.
    if (type === 'web') {
        socket.emit('update_session', `${sessionId}:${currentThreadId}`);
    }
    
    // Reset streaming state
    streamingMessage = null;
    
    // Clear UI and reload history
    messagesDiv.innerHTML = '';
    await loadHistory();
    await loadSessions();
};

window.createNewChat = async () => {
    const newThreadId = 'thread_' + Date.now();
    await switchSession(newThreadId, 'web');
};

window.deleteSession = async (id, type = 'web') => {
    if (!await showConfirm(translations[currentLang].deleteConfirm, null, { type: 'danger' })) return;
    
    // Construct API ID
    let apiId = id;
    if (type === 'web') {
        apiId = `${sessionId}:${id}`;
    }
    
    await fetch(`/api/sessions/${apiId}`, { method: 'DELETE' });
    
    if (currentThreadId === id && currentSessionChannel === type) {
            // Switch to another session if current one deleted
            if (type === 'web') {
            await createNewChat();
            } else {
            // Just reload, maybe switch to web chat
            await createNewChat();
            }
    } else {
        await loadSessions();
    }
};

window.setLanguage = (lang) => {
    currentLang = lang;
    localStorage.setItem('lang', lang);
    updateUIStrings();
    if (!configPanel.classList.contains('translate-x-full')) {
        refreshConfig();
    }
};

function updateStatusUI() {
    const t = translations[currentLang];
    const isConnected = socket.connected;
    statusText.textContent = isConnected ? t.connected : t.disconnected;
}

// Auto-expand textarea
messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.dispatchEvent(new Event('submit'));
    }
});

// Connection handling
socket.on('connect', () => {
    statusDot.classList.replace('bg-red-500', 'bg-green-500');
    statusDot.classList.replace('shadow-[0_0_8px_rgba(239,68,68,0.5)]', 'shadow-[0_0_8px_rgba(34,197,94,0.5)]');
    messageInput.disabled = false;
    sendBtn.disabled = false;
    updateStatusUI();
    addSystemMessage(translations[currentLang].connectedToServer);
    loadHistory();
    loadSessions();
});

async function loadHistory() {
    const token = localStorage.getItem('admin_token');
    if (!token) return;

    try {
        let apiSessionId = currentThreadId;
        if (currentSessionChannel === 'web') {
            apiSessionId = `${sessionId}:${currentThreadId}`;
        }
        const res = await fetch(`/api/history?sessionId=${apiSessionId}`);
        const messages = await res.json();

        // Sort messages by timestamp to ensure correct order
        messages.sort((a, b) => {
            const t1 = new Date(a.timestamp || a.created_at || a.createdAt || 0).getTime();
            const t2 = new Date(b.timestamp || b.created_at || b.createdAt || 0).getTime();
            return t1 - t2;
        });
        
        // Update Input State based on channel
        if (currentSessionChannel !== 'web') {
            messageInput.disabled = true;
            sendBtn.disabled = true;
            messageInput.placeholder = "WeChat session (read-only)";
        } else {
            messageInput.disabled = false;
            sendBtn.disabled = false;
            messageInput.placeholder = translations[currentLang].typePlaceholder;
        }
        
        messagesDiv.innerHTML = '';
        if (messages.length > 0) {
            messages.forEach(msg => {
                // Fix: Check if message is from the current thread (if thread ID is stored in message)
                // But current backend API already filters by sessionId:threadId, so all messages returned are for this thread.
                
                // Fix: Ensure content is not undefined/null
                const content = msg.content || '';
                
                if (msg.role === 'user') {
                    addMessage(content, 'user', false, msg.timestamp || msg.created_at || msg.createdAt);
                } else if (msg.role === 'assistant') {
                    let metadata = msg.metadata;
                    
                    // Heuristic for legacy task notifications (check content pattern if metadata is missing)
                    if (!metadata || !metadata.type) {
                        const taskMatch = content.match(/^\s*✅ Task (\w+) Completed\nStatus: ([\w_]+)\nOutput: ([\s\S]*)$/);
                        if (taskMatch) {
                            metadata = {
                                type: 'task_notification',
                                taskId: taskMatch[1],
                                status: taskMatch[2],
                                output: taskMatch[3]
                            };
                        }
                    }

                    if (metadata && metadata.type === 'task_notification') {
                        const html = renderTaskNotification(metadata, content);
                        addMessage(html, 'bot', false, msg.timestamp || msg.created_at || msg.createdAt, true);
                    } else {
                        addMessage(content, 'bot', false, msg.timestamp || msg.created_at || msg.createdAt);
                    }
                } else if (msg.role === 'system') {
                    addSystemMessage(content);
                }
            });
            // Highlight existing code blocks
            highlightAndCopy(messagesDiv);
        } else {
            // Show welcome message
            messagesDiv.innerHTML = `
                <div class="max-w-3xl mx-auto text-center py-12 space-y-6">
                    <div class="w-20 h-20 bg-blue-50 text-blue-600 rounded-[2rem] flex items-center justify-center mx-auto text-3xl shadow-inner">
                        <i class="fas fa-robot"></i>
                    </div>
                    <div class="space-y-2">
                        <h3 class="text-3xl font-black text-slate-800">${translations[currentLang].welcomeTitle}</h3>
                        <p class="text-slate-500 max-w-sm mx-auto font-medium">${translations[currentLang].welcomeDesc}</p>
                    </div>
                </div>
            `;
        }
    } catch (err) {
        console.error('Failed to load history', err);
    }
}

socket.on('disconnect', () => {
    statusDot.classList.replace('bg-green-500', 'bg-red-500');
    statusDot.classList.replace('shadow-[0_0_8px_rgba(34,197,94,0.5)]', 'shadow-[0_0_8px_rgba(239,68,68,0.5)]');
    messageInput.disabled = true;
    sendBtn.disabled = true;
    const stopBtn = document.getElementById('stop-btn');
    if (stopBtn) stopBtn.disabled = true;
    updateStatusUI();
    addSystemMessage(translations[currentLang].disconnectedFromServer);
});

// Message handling
let streamingMessage = null;

function processMessageContent(text) {
    // Replace <thinking> tags with <details>
    // Note: marked.js might wrap content in <p>, so we rely on marked to handle HTML
    let html = text
        .replace(/<thinking>/g, '<details class="thinking-process"><summary><i class="fas fa-brain"></i> Thinking Process</summary>')
        .replace(/<\/thinking>/g, '</details>');
        
    // Handle unclosed tags for streaming (close them temporarily)
    if ((text.match(/<thinking>/g) || []).length > (text.match(/<\/thinking>/g) || []).length) {
        html += '</details>';
    }
    return marked.parse(html);
}

function renderTaskNotification(metadata, content) {
    const { taskId, status } = metadata;
    const isSuccess = status === 'success' || status === 'completed';
    const isFailed = status === 'failed';
    
    const icon = isSuccess ? 'fa-check-circle' : (isFailed ? 'fa-times-circle' : 'fa-info-circle');
    const iconBg = isSuccess ? 'bg-green-100' : (isFailed ? 'bg-red-100' : 'bg-slate-100');
    const iconColor = isSuccess ? 'text-green-600' : (isFailed ? 'text-red-600' : 'text-slate-500');
    const title = isSuccess ? 'Task Completed' : (isFailed ? 'Task Failed' : 'Task Update');
    
    return `
    <div class="flex items-center gap-3 bg-white p-3 rounded-lg border border-slate-100 shadow-sm my-1">
       <div class="w-10 h-10 rounded-full ${iconBg} flex items-center justify-center flex-shrink-0">
           <i class="fas ${icon} ${iconColor} text-lg"></i>
       </div>
       <div class="flex-1 min-w-0">
           <div class="font-bold text-slate-700 truncate">${title}</div>
           <div class="text-xs text-slate-500 truncate font-mono">ID: ${taskId}</div>
       </div>
       <button onclick="showTaskDetail('${taskId}')" class="px-3 py-1.5 bg-blue-50 text-blue-600 text-xs font-bold rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1">
           <i class="fas fa-external-link-alt"></i>
           <span>View</span>
       </button>
    </div>
    <div class="text-xs text-slate-500 mt-1 pl-1">
       ${processMessageContent(content)}
    </div>
    `;
}

socket.on('message', (data) => {
    hideThinking();
    if (data.is_stream) {
        addMessage(data.content, 'bot', true);
    } else {
        if (streamingMessage) {
            const bubble = streamingMessage.querySelector('.message-bubble');
            bubble.innerHTML = processMessageContent(data.content);
            bubble.classList.remove('streaming-text');
            // Apply highlight and copy buttons to the finalized message
            highlightAndCopy(bubble);
            streamingMessage = null;
        } else {
            // Check for Task Notification
            if (data.metadata && data.metadata.type === 'task_notification') {
                 const html = renderTaskNotification(data.metadata, data.content);
                 addMessage(html, 'bot', false, null, true);
            } else {
                addMessage(data.content, 'bot');
            }

            // Apply highlight and copy buttons to the newly added message
            const lastBubble = messagesDiv.querySelector('.message-row:last-child .message-bubble');
            if (lastBubble) highlightAndCopy(lastBubble);
        }
        loadSessions(); // Update title after receiving a full message
        setGenerationState(false);
    }
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

socket.on('system_event', (event) => {
    console.log('System event received:', event);
    if (event.type === 'channel:wechat:scan') {
        // Show QR code for WeChat Login
        console.log('Received WeChat QR code, displaying now.');
        showQR(event.data.qrcode, 'WeChat Login');
    } else if (event.type === 'channel:wechat:login_success') {
        closeQRModal();
        if (wechatLoginBtn) {
            wechatLoginBtn.classList.add('hidden');
        }
        
        // Only switch session ID if we are sure the user INTENDED to login.
        // If the user never scanned a QR code, this might be a reconnection event from the server
        // for a PREVIOUS session or another user (if running locally).
        
        // For now, let's only log it but NOT switch the session automatically unless we are in a specific state.
        // Or, we can just let the user stay on their web session.
        
        const t = translations[currentLang];
        const msg = t.wechatLoggedIn.replace('{user}', event.data.user);
        addSystemMessage(msg);

        // Try to link this WeChat account to the current Web User
        const token = localStorage.getItem('admin_token');
        if (token && event.data.userId) {
            fetch('/api/user/link', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    provider: 'wechat',
                    providerId: event.data.userId,
                    providerName: event.data.user,
                    providerData: event.data
                })
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'ok') {
                    addSystemMessage(t.linkedAccountSuccess.replace('{user}', event.data.user));
                } else {
                    console.error('Failed to link account:', data.error);
                    addSystemMessage(t.linkedAccountError.replace('{error}', data.error));
                }
            })
            .catch(err => {
                console.error('Error linking account:', err);
                addSystemMessage(t.linkedAccountError.replace('{error}', err.message));
            });
        }
    }
});

function showQR(rawUrl, title) {
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(rawUrl)}&size=256x256`;
    const t = translations[currentLang];
    
    const img = new Image();
    img.src = qrApiUrl;
    img.alt = "QR Code";
    img.className = "w-60 h-60 rounded-2xl shadow-lg";
    
    qrContainer.innerHTML = '';
    qrContainer.appendChild(img);
    qrStatus.textContent = t.pleaseScan.replace('{title}', title);

    if (wechatLoginBtn) {
        // Show the floating button instead of modal
        wechatLoginBtn.classList.remove('hidden');
        wechatLoginBtn.classList.add('animate-pulse');
        wechatLoginBtn.querySelector('span')?.classList.add('animate-bounce');
        addSystemMessage(t.wechatLoginAvailable);
    } else {
        // Fallback
        qrModal.classList.remove('hidden');
    }
}

window.closeQRModal = () => qrModal.classList.add('hidden');

// Close QR Modal when clicking outside content
qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) {
        closeQRModal();
    }
});

window.stopGeneration = () => {
    socket.emit('stop_generation');
    // We don't immediately reset UI here, we wait for the final message from server
    // or we can optimistically disable the stop button
    const stopBtn = document.getElementById('stop-btn');
    if (stopBtn) stopBtn.disabled = true;
};

function setGenerationState(isGenerating) {
    const sendBtn = document.getElementById('send-btn');
    const stopBtn = document.getElementById('stop-btn');
    const messageInput = document.getElementById('message-input');
    
    if (isGenerating) {
        if (sendBtn) {
            sendBtn.classList.add('hidden');
            sendBtn.disabled = true;
        }
        if (stopBtn) {
            stopBtn.classList.remove('hidden');
            stopBtn.disabled = false;
        }
        if (messageInput) messageInput.disabled = true;
    } else {
        if (sendBtn) {
            sendBtn.classList.remove('hidden');
            sendBtn.disabled = false;
        }
        if (stopBtn) {
            stopBtn.classList.add('hidden');
            stopBtn.disabled = true;
        }
        if (messageInput) {
            messageInput.disabled = false;
            messageInput.focus();
        }
    }
}

window.toggleConfig = () => {
    const isHidden = configPanel.classList.contains('translate-x-full');
    if (isHidden) {
        configPanel.classList.remove('translate-x-full');
        configOverlay.classList.remove('hidden');
        refreshConfig();
    } else {
        configPanel.classList.add('translate-x-full');
        configOverlay.classList.add('hidden');
    }
};

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (text) {
        // Force finalize any previous streaming message
        if (streamingMessage) {
            const bubble = streamingMessage.querySelector('.message-bubble');
            if (bubble) bubble.classList.remove('streaming-text');
            streamingMessage = null;
        }

        socket.emit('message', { text });
        // Reset streaming message state to prevent appending new bot messages to old streams
        streamingMessage = null;
        addMessage(text, 'user');
        messageInput.value = '';
        messageInput.style.height = 'auto';
        showThinking();
        setGenerationState(true);
    }
});

function addMessage(text, role, isStreaming = false, timestamp = null, isRawHtml = false) {
    // Hide welcome message on first real message
    const welcome = document.getElementById('welcome-message');
    if (welcome) welcome.remove();

    // Check if we need to create a message container
    let container = messagesDiv.querySelector('.message-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'message-container';
        messagesDiv.appendChild(container);
    }

    const t = translations[currentLang];
    const isUser = role === 'user';
    
    if (isStreaming && streamingMessage) {
        const bubble = streamingMessage.querySelector('.message-bubble');
        // Accumulate text for smooth streaming effect
        const currentText = streamingMessage.dataset.rawText || '';
        const newText = currentText + text;
        streamingMessage.dataset.rawText = newText;
        
        bubble.innerHTML = processMessageContent(newText);
        
        // Ensure copy button exists even during streaming (re-append if overwritten)
        if (!bubble.querySelector('.message-copy-btn')) {
             const copyBtn = createCopyButton(newText);
             bubble.appendChild(copyBtn);
        } else {
             // Update the click handler with new text
             const copyBtn = bubble.querySelector('.message-copy-btn');
             copyBtn.onclick = (e) => handleCopy(e, newText, copyBtn);
        }

        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        return;
    }

    const row = document.createElement('div');
    row.className = `message-row ${isUser ? 'user-row' : 'bot-row'}`;
    
    // Store raw text for copying
    row.dataset.rawText = text;

    const avatar = document.createElement('div');
    avatar.className = `avatar ${isUser ? 'user-avatar' : 'bot-avatar'}`;
    avatar.innerHTML = `<i class="fas ${isUser ? 'fa-user' : 'fa-robot'}"></i>`;
    
    const wrapper = document.createElement('div');
    wrapper.className = 'message-content-wrapper';
    
    const label = document.createElement('div');
    label.className = 'message-label';
    
    // Create label content with timestamp
    const nameSpan = document.createElement('span');
    nameSpan.textContent = isUser ? t.userName : t.botName;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-timestamp';
    const dateObj = timestamp ? new Date(timestamp) : new Date();
    // Format: HH:MM:SS
    timeSpan.textContent = dateObj.toLocaleTimeString([], { hour12: false }); 
    
    label.appendChild(nameSpan);
    label.appendChild(timeSpan);
    
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isUser ? 'user-message' : 'bot-message'} ${isStreaming ? 'streaming-text' : ''}`;
    
    // Initialize rawText for streaming message
    if (isStreaming) {
        row.dataset.rawText = text;
    }

    bubble.innerHTML = isUser ? escapeHtml(text) : (isRawHtml ? text : processMessageContent(text));
    
    // Add Copy Button
    const copyBtn = createCopyButton(text);
    bubble.appendChild(copyBtn);

    wrapper.appendChild(label);
    wrapper.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(wrapper);
    
    container.appendChild(row);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    if (isStreaming) {
        streamingMessage = row;
    }
}

function createCopyButton(text) {
    const btn = document.createElement('button');
    btn.className = 'message-copy-btn';
    btn.innerHTML = '<i class="fas fa-copy"></i>';
    btn.title = 'Copy message';
    btn.onclick = (e) => handleCopy(e, text, btn);
    return btn;
}

function handleCopy(e, text, btn) {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-copy"></i>';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

function showThinking() {
    if (isThinking) return;
    isThinking = true;
    
    let container = messagesDiv.querySelector('.message-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'message-container';
        messagesDiv.appendChild(container);
    }

    const row = document.createElement('div');
    row.className = 'message-row bot-row';
    row.id = 'thinking-bubble';
    
    const avatar = document.createElement('div');
    avatar.className = 'avatar bot-avatar';
    avatar.innerHTML = '<i class="fas fa-robot"></i>';
    
    const wrapper = document.createElement('div');
    wrapper.className = 'message-content-wrapper';
    
    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = translations[currentLang].botName;
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble bot-message';
    bubble.innerHTML = `
        <div class="thinking-container">
            <div class="thinking-pulse"></div>
            <span class="i18n-thinking">${currentLang === 'zh' ? 'Nanobot 正在思考...' : 'Nanobot is thinking...'}</span>
            <div class="thinking-dots">
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
            </div>
        </div>
    `;
    
    wrapper.appendChild(label);
    wrapper.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(wrapper);
    
    container.appendChild(row);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function hideThinking() {
    const thinkingBubble = document.getElementById('thinking-bubble');
    if (thinkingBubble) {
        thinkingBubble.remove();
    }
    isThinking = false;
}

function addSystemMessage(text) {
    let container = messagesDiv.querySelector('.message-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'message-container';
        messagesDiv.appendChild(container);
    }
    const div = document.createElement('div');
    div.className = 'flex justify-center my-6';
    div.innerHTML = `<span class="system-pill shadow-sm hover:shadow-md transition-shadow cursor-default">${text}</span>`;
    container.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function scrollToBottom() {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.refreshConfig = async () => {
    const content = document.getElementById('config-content');
    content.innerHTML = `<div class="flex flex-col items-center justify-center py-20 text-slate-400">
        <i class="fas fa-circle-notch fa-spin text-3xl mb-6 text-blue-500"></i>
        <span class="text-sm font-bold tracking-widest uppercase">${translations[currentLang].loadingConfig}</span>
    </div>`;
    
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        window.currentConfig = config; // Store for reference
        renderConfig(config);
    } catch (err) {
        console.error('Failed to load config', err);
        content.innerHTML = `<div class="text-red-500 p-4">Error loading config: ${err.message}</div>`;
    }
}

window.saveConfig = async () => {
    if (!await showConfirm(translations[currentLang].confirmBackup, null, { type: 'warning' })) return;
    
    const inputs = document.querySelectorAll('#config-content [data-path]');
    const newConfig = {};
    
    // Reconstruct config object from inputs
    inputs.forEach(input => {
        const path = input.dataset.path.split('.');
        let current = newConfig;
        
        // Create nested structure
        for (let i = 0; i < path.length - 1; i++) {
            if (!current[path[i]]) current[path[i]] = {};
            current = current[path[i]];
        }
        
        const key = path[path.length - 1];
        let value = input.value;
        
        // Type conversion
        if (input.type === 'checkbox') {
            value = input.checked;
        } else if (input.type === 'number') {
            value = Number(value);
        } else if (input.dataset.type === 'array') {
            try {
                value = JSON.parse(value);
            } catch (e) {
                alert(`Invalid JSON for ${key}`);
                return;
            }
        }
        
        current[key] = value;
    });
    
    try {
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newConfig)
        });
        
        const data = await res.json();
        if (data.status === 'ok') {
            alert(translations[currentLang].savedSuccess);
            refreshConfig();
        } else {
            alert(`${translations[currentLang].saveError}: ${data.message}`);
        }
    } catch (err) {
        alert(`${translations[currentLang].saveError}: ${err.message}`);
    }
};

window.editTaskName = async (taskId) => {
    const t = translations[currentLang];
    const task = window.lastTasks.find(t => t.id === taskId);
    if (!task) return;
    
    const newName = prompt(t.enterNewTitle || 'Enter new title:', task.name || '');
    if (newName === null) return; // Cancelled
    
    try {
        const res = await fetch(`/api/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });
        
        if (!res.ok) throw new Error('Failed to update');
        
        loadTasks(); // Reload to refresh
    } catch (err) {
        alert(t.updateTitleError || 'Failed to update title');
        console.error(err);
    }
};

function renderConfig(config) {
    const container = document.getElementById('config-content');
    container.innerHTML = '';

    function renderNode(key, value, level = 0, parentPath = '') {
        const currentPath = parentPath ? `${parentPath}.${key}` : key;
        const meta = configMeta[currentPath] || {};
        
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            const section = document.createElement('div');
            section.className = level === 0 ? 'space-y-6' : 'mt-6 ml-4 pl-4 border-l-2 border-slate-100';
            
            const title = document.createElement('h3');
            title.className = level === 0 
                ? 'text-[11px] font-black uppercase tracking-[0.2em] text-blue-600/60 mb-4 flex items-center gap-2' 
                : 'text-xs font-bold text-slate-500 mb-3';
            
            if (level === 0) {
                const dot = document.createElement('span');
                dot.className = 'w-1.5 h-1.5 rounded-full bg-blue-500';
                title.appendChild(dot);
            }
            
            const text = document.createElement('span');
            text.textContent = meta.label || key;
            title.appendChild(text);
            
            if (meta.desc) {
                title.title = meta.desc; // Tooltip for section
            }
            
            section.appendChild(title);
            container.appendChild(section);
            
            Object.entries(value).forEach(([k, v]) => renderNode(k, v, level + 1, currentPath));
        } else {
            const item = document.createElement('div');
            item.className = 'flex flex-col gap-1.5 py-3';
            
            const labelContainer = document.createElement('div');
            labelContainer.className = 'flex items-baseline justify-between';
            
            const label = document.createElement('label');
            label.className = 'config-item-label';
            label.textContent = meta.label || key;
            label.htmlFor = `config-${currentPath}`;
            
            labelContainer.appendChild(label);
            
            if (meta.desc) {
                const desc = document.createElement('span');
                desc.className = 'text-[10px] text-slate-400 font-medium';
                desc.textContent = meta.desc;
                labelContainer.appendChild(desc);
            }
            
            let input;
            const isArray = Array.isArray(value);
            
            if (typeof value === 'boolean') {
                // Checkbox wrapper
                const wrapper = document.createElement('div');
                wrapper.className = 'flex items-center gap-3';
                
                input = document.createElement('input');
                input.type = 'checkbox';
                input.className = 'w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 transition-all';
                input.checked = value;
                
                const statusLabel = document.createElement('span');
                statusLabel.className = 'text-sm font-medium text-slate-600';
                statusLabel.textContent = value ? 'Enabled' : 'Disabled';
                
                input.onchange = () => {
                    statusLabel.textContent = input.checked ? 'Enabled' : 'Disabled';
                };
                
                wrapper.appendChild(input);
                wrapper.appendChild(statusLabel);
                item.appendChild(labelContainer);
                item.appendChild(wrapper);
            } else if (typeof value === 'number') {
                input = document.createElement('input');
                input.type = 'number';
                input.className = 'config-item-value w-full focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none';
                input.value = value;
                item.appendChild(labelContainer);
                item.appendChild(input);
            } else {
                // String or Array (as JSON string)
                if (value.length > 50 || isArray) {
                    input = document.createElement('textarea');
                    input.rows = 3;
                    input.className = 'config-item-value w-full focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none font-mono text-xs';
                } else {
                    input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'config-item-value w-full focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none';
                }
                
                if (isArray) {
                    input.value = JSON.stringify(value, null, 2);
                    input.dataset.type = 'array';
                } else {
                    input.value = value || '';
                }
                
                item.appendChild(labelContainer);
                item.appendChild(input);
            }

            // Common attributes
            if (input) {
                input.id = `config-${currentPath}`;
                input.dataset.path = currentPath;
                if (!input.dataset.type && typeof value !== 'object') {
                        input.dataset.type = typeof value;
                }
            }
            
            container.appendChild(item);
        }
    }

    Object.entries(config).forEach(([k, v]) => renderNode(k, v));
}

// --- Media Preview Logic ---
const mediaModal = document.getElementById('media-modal');
const mediaModalContent = document.getElementById('media-modal-content');
const mediaContainer = document.getElementById('media-container');
const mediaCaption = document.getElementById('media-caption');
const mediaOpenBtn = document.getElementById('media-open-btn');

window.closeMediaModal = () => {
    mediaModal.classList.add('opacity-0');
    if (mediaModalContent) mediaModalContent.classList.remove('scale-100');
    
    setTimeout(() => {
        mediaModal.classList.add('hidden');
        mediaContainer.innerHTML = ''; // Clear content to stop video/audio
    }, 300);
};

// Close on click outside
if (mediaModal) {
    mediaModal.addEventListener('click', (e) => {
        if (e.target === mediaModal || e.target === mediaContainer) {
            closeMediaModal();
        }
    });
}

// Global click delegation for links in messages
messagesDiv.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    
    // Check if the link is within a message bubble
    if (!messagesDiv.contains(link)) return;
    
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

    e.preventDefault();
    openMediaPreview(href);
});

function openMediaPreview(url) {
    const ext = url.split('.').pop().toLowerCase().split('?')[0];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'mkv'];
    const audioExts = ['mp3', 'wav', 'm4a', 'flac', 'aac'];
    const textExts = ['txt', 'md', 'json', 'js', 'ts', 'py', 'html', 'css', 'log', 'csv', 'xml', 'yaml', 'yml'];
    const pdfExts = ['pdf'];

    let type = 'unknown';
    if (imageExts.includes(ext)) type = 'image';
    else if (videoExts.includes(ext)) type = 'video';
    else if (audioExts.includes(ext)) type = 'audio';
    else if (textExts.includes(ext)) type = 'text'; // We can try to fetch or use iframe, but iframe is safer for now
    else if (pdfExts.includes(ext)) type = 'pdf';

    // Set open button
    mediaOpenBtn.href = url;
    
    // Update caption
    mediaCaption.textContent = url.split('/').pop();
    mediaCaption.classList.remove('hidden');

    mediaContainer.innerHTML = ''; // Clear previous

    if (type === 'image') {
        const img = document.createElement('img');
        img.src = url;
        img.className = 'max-w-full max-h-full object-contain rounded-lg shadow-2xl';
        mediaContainer.appendChild(img);
        showModal();
    } else if (type === 'video') {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.autoplay = true;
        video.className = 'max-w-full max-h-full rounded-lg shadow-2xl';
        mediaContainer.appendChild(video);
        showModal();
    } else if (type === 'audio') {
        const audio = document.createElement('audio');
        audio.src = url;
        audio.controls = true;
        audio.autoplay = true;
        audio.className = 'w-full max-w-md bg-white rounded-full shadow-xl p-2';
        mediaContainer.appendChild(audio);
        showModal();
    } else if (type === 'pdf' || type === 'text') {
        // Use iframe for PDF and text files
        const iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.className = 'w-full h-full bg-white rounded-lg shadow-2xl';
        mediaContainer.appendChild(iframe);
        showModal();
    } else {
        // Unknown type - fallback to new tab
        window.open(url, '_blank');
    }
}

function showModal() {
    mediaModal.classList.remove('hidden');
    // Trigger reflow
    void mediaModal.offsetWidth;
    mediaModal.classList.remove('opacity-0');
    if (mediaModalContent) mediaModalContent.classList.add('scale-100');
}

let currentTaskFilter = 'all';
window.lastTasks = [];

// Close modal when clicking outside
if (tasksModal) {
    tasksModal.addEventListener('click', (e) => {
        if (e.target === tasksModal) {
            toggleTasks();
        }
    });
}

window.toggleTasks = () => {
    if (tasksModal.classList.contains('hidden')) {
        tasksModal.classList.remove('hidden');
        // Trigger reflow for transition
        void tasksModal.offsetWidth;
        tasksModal.classList.remove('opacity-0');
        tasksModalContent.classList.remove('scale-95');
        loadTasks();
    } else {
        tasksModal.classList.add('opacity-0');
        tasksModalContent.classList.add('scale-95');
        setTimeout(() => {
            tasksModal.classList.add('hidden');
        }, 300);
    }
};

window.switchTaskTab = (tab) => {
    currentTaskFilter = tab;
    
    // Update active tab UI
    document.querySelectorAll('.task-tab').forEach(el => {
        if (el.dataset.tab === tab) {
            el.classList.add('active', 'text-blue-600', 'border-blue-600');
            el.classList.remove('text-slate-500', 'border-transparent', 'hover:text-slate-700', 'hover:border-slate-200');
        } else {
            el.classList.remove('active', 'text-blue-600', 'border-blue-600');
            el.classList.add('text-slate-500', 'border-transparent', 'hover:text-slate-700', 'hover:border-slate-200');
        }
    });
    
    // Re-render tasks
    if (window.lastTasks) {
        renderTasks(window.lastTasks);
    }
};

window.loadTasks = async () => {
    const content = document.getElementById('tasks-content');
    const t = translations[currentLang];
    
    content.innerHTML = `<div class="flex flex-col items-center justify-center py-20 text-slate-400">
        <i class="fas fa-circle-notch fa-spin text-3xl mb-6 text-blue-500"></i>
        <span class="text-sm font-bold tracking-widest uppercase">${t.loadingTasks || 'Loading tasks...'}</span>
    </div>`;
    
    try {
        const res = await fetch('/api/tasks');
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                 showLogin();
                 return;
            }
            throw new Error(`Failed to fetch tasks: ${res.status} ${res.statusText}`);
        }
        const tasks = await res.json();
        window.lastTasks = tasks;
        renderTasks(tasks);
    } catch (err) {
        console.error('Failed to load tasks', err);
        // Fallback to empty state on error to avoid ugly error UI
        window.lastTasks = [];
        renderTasks([]);
    }
};

function renderTasks(tasks) {
    const content = document.getElementById('tasks-content');
    const countEl = document.getElementById('tasks-count');
    const t = translations[currentLang];
    content.innerHTML = '';
    
    if (!Array.isArray(tasks) || tasks.length === 0) {
        content.innerHTML = `<div class="text-center text-slate-400 py-20 italic">${t.noTasks}</div>`;
        if (countEl) countEl.textContent = (t.tasksCount || '0 Tasks').replace('{count}', 0);
        return;
    }
    
    // Filter tasks
    const filteredTasks = tasks.filter(task => {
        const isTaskRunaway = (task.status === 'in_progress' || task.status === 'running') && !task.schedule && !task.cron;
        
        if (currentTaskFilter === 'all') return true;
        if (currentTaskFilter === 'pending') return task.status === 'pending';
        if (currentTaskFilter === 'in_progress') return task.status === 'in_progress' || task.status === 'running';
        if (currentTaskFilter === 'paused') return task.status === 'paused';
        if (currentTaskFilter === 'completed') return task.status === 'completed';
        if (currentTaskFilter === 'failed') return task.status === 'failed';
        if (currentTaskFilter === 'runaway') return isTaskRunaway;
        return true;
    });

    if (countEl) countEl.textContent = (t.tasksCount || '{count} Tasks').replace('{count}', filteredTasks.length);

    if (filteredTasks.length === 0) {
        content.innerHTML = `<div class="text-center text-slate-400 py-20 italic">${t.noTasksFilter || 'No tasks found for this filter'}</div>`;
        return;
    }
    
    filteredTasks.forEach(task => {
        const locale = currentLang === 'zh' ? 'zh-CN' : 'en-US';
        const item = document.createElement('div');
        item.id = `task-card-${task.id}`;
        item.className = 'bg-white rounded-xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-all space-y-3';
        
        let statusColor, statusIcon, statusText;
        const isTaskRunaway = (task.status === 'in_progress' || task.status === 'running') && !task.schedule && !task.cron;
        
        if (isTaskRunaway) {
             statusColor = 'text-amber-600 bg-amber-50 border border-amber-100 animate-pulse';
             statusIcon = 'fa-exclamation-triangle';
             statusText = t.taskRunaway || 'Runaway';
        } else if (task.status === 'in_progress' || task.status === 'running') {
            statusColor = 'text-blue-600 bg-blue-50 border border-blue-100';
            statusIcon = 'fa-spinner fa-spin';
            statusText = t.taskStatusInProgress;
        } else if (task.status === 'paused') {
            statusColor = 'text-amber-600 bg-amber-50 border border-amber-100';
            statusIcon = 'fa-pause-circle';
            statusText = t.taskStatusPaused;
        } else if (task.status === 'completed') {
            statusColor = 'text-green-600 bg-green-50 border border-green-100';
            statusIcon = 'fa-check-circle';
            statusText = t.taskStatusCompleted;
        } else if (task.status === 'failed') {
            statusColor = 'text-red-600 bg-red-50 border border-red-100';
            statusIcon = 'fa-times-circle';
            statusText = t.taskStatusFailed;
        } else {
            statusColor = 'text-slate-500 bg-slate-100 border border-slate-200';
            statusIcon = 'fa-clock';
            statusText = t.taskStatusPending;
        }

            // Data Inference
            let displayType = task.type;
            if (task.tags && task.tags.some(t => t.startsWith('system:'))) {
                displayType = 'system';
            }
            const taskType = displayType || (task.tags && task.tags.length > 0 ? task.tags[0] : 'General');
            const taskSchedule = task.cron || '-';
            
            let lastRunTime = task.lastRun;
            // Check history for latest timestamp if lastRun is missing
            if (!lastRunTime && task.history && task.history.length > 0) {
                // Find the latest timestamp in history
                const latestHistory = task.history.reduce((latest, current) => {
                    const cTs = current.executed_at || current.timestamp;
                    const lTs = latest.executed_at || latest.timestamp;
                    // Handle cases where timestamp might be missing or invalid
                    const currentTs = cTs ? new Date(cTs).getTime() : 0;
                    const latestTs = lTs ? new Date(lTs).getTime() : 0;
                    return currentTs > latestTs ? current : latest;
                });
                
                const latestTs = latestHistory.executed_at || latestHistory.timestamp;
                if (latestTs) {
                    lastRunTime = latestTs;
                }
            }
            // Fallback to updated_at if status implies activity
            if (!lastRunTime && (task.status === 'completed' || task.status === 'failed') && task.updated_at) {
                lastRunTime = task.updated_at;
            }
            
            const lastRunDisplay = (lastRunTime && !isNaN(new Date(lastRunTime).getTime())) 
                ? new Date(lastRunTime).toLocaleString(locale) 
                : '-';

            // Support both backend next_run (new) and potentially legacy nextRun
            const nextRunVal = task.next_run || task.nextRun;
            const nextRunDisplay = (nextRunVal && !isNaN(new Date(nextRunVal).getTime()))
                ? new Date(nextRunVal).toLocaleString(locale) 
                : '-';
        
        const maxExecutions = task.max_executions || 0;
        const executionCount = task.execution_count || 0;
        const executionDisplay = maxExecutions > 0 ? `${executionCount} / ${maxExecutions}` : `${executionCount} (∞)`;

            
            // Task Name / Content Display
            // If it's a code block (starts with def/import/etc or contains newlines), show a summary
            let displayName = task.name || task.content || 'Unnamed Task';
            let displayDesc = '';
            
            // Check if content looks like code
            const isCode = displayName.includes('\n') || 
                          displayName.startsWith('def ') || 
                          displayName.startsWith('import ') ||
                          displayName.length > 50;
                          
            if (isCode) {
                // Try to extract a meaningful title from comments or first line
                const lines = displayName.split('\n');
                const firstLine = lines[0].trim();
                
                // If first line is a comment, use it as title
                if (firstLine.startsWith('#') || firstLine.startsWith('//')) {
                    displayName = firstLine.replace(/^#+\s*|\/\/+\s*/, '');
                } else if (task.name) {
                    displayName = task.name;
                } else {
                    displayName = `Task ${task.id.substring(0, 8)}...`;
                }
                
                // Store full content for detail view
                displayDesc = task.content || '';
            }

            const createdTime = task.created_at ? new Date(task.created_at).toLocaleString(locale) : '';

            item.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="flex-1 min-w-0 pr-4">
                    <div class="flex items-center gap-2 group/title mb-1 cursor-pointer" onclick="editTaskName('${task.id}')" title="${t.clickToEdit || 'Click to edit'}">
                        <h3 id="task-title-${task.id}" class="font-bold text-slate-800 text-base truncate group-hover/title:text-blue-600 transition-colors">${displayName}</h3>
                        <i class="fas fa-pen text-[10px] text-slate-300 opacity-0 group-hover/title:opacity-100 transition-opacity"></i>
                    </div>
                    <div class="flex flex-wrap items-center gap-2 mb-2">
                        <div class="text-xs text-slate-400 font-mono bg-slate-50 px-2 py-1 rounded inline-block select-all cursor-text" title="ID">${task.id}</div>
                        ${createdTime ? `
                        <div class="text-xs text-slate-400 flex items-center" title="${t.taskCreatedAt || 'Created At'}">
                            <i class="far fa-calendar-plus mr-1"></i>
                            <span>${createdTime}</span>
                        </div>` : ''}
                    </div>
                    ${displayDesc ? `
                    <details class="group">
                        <summary class="text-xs text-blue-500 cursor-pointer hover:text-blue-700 font-medium select-none flex items-center gap-1">
                            <i class="fas fa-chevron-right text-[10px] group-open:rotate-90 transition-transform"></i>
                            <span>${t.viewDetails || 'View Details'}</span>
                        </summary>
                        <div class="mt-2 bg-slate-50 rounded p-2 text-xs font-mono text-slate-600 overflow-x-auto whitespace-pre-wrap border border-slate-100 max-h-40 overflow-y-auto custom-scrollbar">
                            ${escapeHtml(displayDesc)}
                        </div>
                    </details>
                    ` : ''}
                </div>
                <div class="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 flex-shrink-0 ${statusColor}">
                    <i class="fas ${statusIcon}"></i>
                    <span>${statusText}</span>
                </div>
            </div>
            
            <div class="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs pt-2">
                <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <div class="text-slate-400 mb-1 font-bold uppercase tracking-wider text-[10px]">${t.taskType}</div>
                    <div class="font-medium text-slate-700 truncate" title="${taskType}">${taskType}</div>
                </div>
                <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <div class="text-slate-400 mb-1 font-bold uppercase tracking-wider text-[10px]">${t.taskCron || 'Schedule'}</div>
                    <div class="font-mono text-slate-600 truncate" title="${taskSchedule}">${taskSchedule}</div>
                </div>
                <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100 relative group/edit">
                    <div class="text-slate-400 mb-1 font-bold uppercase tracking-wider text-[10px] flex justify-between items-center">
                        <span>${t.taskExecutions || 'Executions'}</span>
                        <button onclick="editMaxExecutions('${task.id}', ${maxExecutions})" class="text-blue-500 hover:text-blue-700 opacity-0 group-hover/edit:opacity-100 transition-opacity" title="${t.editMaxExecutions || 'Edit Limit'}">
                            <i class="fas fa-edit"></i>
                        </button>
                    </div>
                    <div class="font-mono text-slate-600 truncate">${executionDisplay}</div>
                </div>
                <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <div class="text-slate-400 mb-1 font-bold uppercase tracking-wider text-[10px]">${t.taskLastRun || 'Last Run'}</div>
                    <div class="font-mono text-slate-600 truncate">${lastRunDisplay}</div>
                </div>
                <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <div class="text-slate-400 mb-1 font-bold uppercase tracking-wider text-[10px]">${t.taskNextRun || 'Next Run'}</div>
                    <div class="font-mono text-slate-600 truncate">${nextRunDisplay}</div>
                </div>
            </div>
            
            ${task.result ? `
            <div class="mt-3 bg-slate-50 rounded-lg p-3 border border-slate-100">
                <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Result</div>
                <div class="text-xs text-slate-600 font-mono whitespace-pre-wrap break-all max-h-20 overflow-y-auto">${task.result}</div>
            </div>` : ''}
            
            <div id="history-${task.id}" class="hidden mt-3 bg-slate-50 rounded-lg p-3 border border-slate-100">
                <div class="flex justify-between items-center mb-2">
                     <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${t.taskHistory || 'History'}</div>
                     ${(task.command && task.command.match(/([^\s"']+\.py)/)) ? `
                     <button onclick="viewSource('${task.command.match(/([^\s"']+\.py)/)[1]}')" class="text-[10px] flex items-center gap-1 text-blue-500 hover:text-blue-600 font-medium transition-colors">
                         <i class="fas fa-code"></i>
                         <span>${t.viewSource || 'View Source'}: ${task.command.match(/([^\s"']+\.py)/)[1].split('/').pop()}</span>
                     </button>
                     ` : ''}
                </div>
                <div class="max-h-60 overflow-y-auto space-y-2 custom-scrollbar pr-1">
                    ${(task.history && task.history.length > 0) ? task.history.map(h => {
                        const status = h.status || 'unknown';
                        const isSuccess = status === 'success' || status === 'completed';
                        const isFailed = status === 'failed';
                        const borderColor = isSuccess ? 'border-green-400' : (isFailed ? 'border-red-400' : 'border-slate-300');
                        const textColor = isSuccess ? 'text-green-600' : (isFailed ? 'text-red-600' : 'text-slate-500');
                        
                        // Support both executed_at (backend) and timestamp (legacy/frontend)
                        const ts = h.executed_at || h.timestamp;
                        const timeStr = (ts && !isNaN(new Date(ts).getTime())) ? new Date(ts).toLocaleString(locale) : '-';
                        
                        // Support both output (backend) and message (legacy)
                        const content = h.output || h.message || '';
                        
                        return `
                        <div class="text-xs border-l-2 ${borderColor} pl-2 py-1 mb-1 hover:bg-slate-50 transition-colors rounded-r">
                            <div class="flex justify-between items-center text-slate-400 text-[10px] mb-1">
                                <span>${timeStr}</span>
                                <span class="uppercase font-bold ${textColor}">${status}</span>
                            </div>
                            <div class="text-slate-600 font-mono whitespace-pre-wrap break-all bg-white p-1.5 rounded border border-slate-100 shadow-sm">${escapeHtml(content)}</div>
                        </div>
                        `;
                    }).join('') : `<div class="text-xs text-slate-400 italic py-2 text-center">${t.noHistory || 'No history records'}</div>`}
                </div>
            </div>

            <div class="mt-4 pt-3 border-t border-slate-100 flex justify-end gap-2">
                 <button class="text-xs font-medium text-slate-500 hover:text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5" onclick="toggleTaskHistory('${task.id}', this)">
                     <i class="fas fa-history"></i>
                     <span>${t.viewHistory || 'View History'}</span>
                 </button>
                 ${(task.type === 'code' || task.type === 'system' || task.content) ? `
                 <button class="text-xs font-medium text-purple-500 hover:text-purple-600 hover:bg-purple-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5" onclick="viewTaskCode('${task.id}')">
                     <i class="fas fa-code"></i>
                     <span>${t.viewCode || 'View Code'}</span>
                 </button>
                 ` : ''}
                 <button class="text-xs font-medium text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5" onclick="runTaskOnce('${task.id}')">
                     <i class="fas fa-bolt"></i>
                     <span>${t.runOnceTask || 'Run Once'}</span>
                 </button>
                 <button class="text-xs font-medium text-blue-500 hover:text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5" onclick="restartTask('${task.id}')">
                     <i class="fas fa-redo-alt"></i>
                     <span>${t.restartTask || 'Restart'}</span>
                 </button>
                 ${task.status === 'paused' ? `
                 <button class="text-xs font-medium text-amber-500 hover:text-amber-600 hover:bg-amber-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5" onclick="resumeTask('${task.id}')">
                     <i class="fas fa-play"></i>
                     <span>${t.resumeTask || 'Resume'}</span>
                 </button>
                 ` : `
                 <button class="text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5" onclick="stopTask('${task.id}')">
                     <i class="fas fa-stop"></i>
                     <span>${t.stopTask || 'Stop'}</span>
                 </button>
                 `}
                 <button class="text-xs font-medium text-slate-400 hover:text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5" onclick="deleteTask('${task.id}')" title="${t.deleteTask || 'Delete Task'}">
                     <i class="fas fa-trash-alt"></i>
                     <span class="hidden md:inline">${t.deleteTask || 'Delete'}</span>
                 </button>
            </div>
        `;
        
        content.appendChild(item);
    });
}

window.showConfirm = (message, title = null, options = {}) => {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const content = document.getElementById('confirm-modal-content');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');
        const iconEl = document.getElementById('confirm-icon');
        const iconBg = document.getElementById('confirm-icon-bg');
        const okBtn = document.getElementById('confirm-ok-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');

        // Set content
        const t = translations[currentLang];
        titleEl.textContent = title || t.confirmTitle || 'Confirmation';
        msgEl.textContent = message;
        
        // Customize icon/color based on type
        const type = options.type || 'info'; // info, warning, danger
        
        // Reset classes
        iconBg.className = 'w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl shadow-sm transition-colors duration-300';
        okBtn.className = 'flex-1 px-4 py-2.5 text-white text-sm font-bold rounded-xl transition-colors shadow-lg';
        
        if (type === 'danger') {
            iconBg.classList.add('bg-red-50', 'text-red-600');
            iconEl.className = 'fas fa-exclamation-triangle';
            okBtn.classList.add('bg-red-600', 'hover:bg-red-700', 'shadow-red-200');
        } else if (type === 'warning') {
            iconBg.classList.add('bg-amber-50', 'text-amber-600');
            iconEl.className = 'fas fa-exclamation';
            okBtn.classList.add('bg-amber-500', 'hover:bg-amber-600', 'shadow-amber-200');
        } else {
            iconBg.classList.add('bg-blue-50', 'text-blue-600');
            iconEl.className = 'fas fa-question';
            okBtn.classList.add('bg-blue-600', 'hover:bg-blue-700', 'shadow-blue-200');
        }

        okBtn.textContent = options.confirmText || t.confirm || 'Confirm';
        cancelBtn.textContent = options.cancelText || t.cancel || 'Cancel';

        // Show modal
        modal.classList.remove('hidden');
        // Trigger reflow
        void modal.offsetWidth;
        modal.classList.remove('opacity-0');
        content.classList.remove('scale-95');

        const cleanup = () => {
            modal.classList.add('opacity-0');
            content.classList.add('scale-95');
            setTimeout(() => {
                modal.classList.add('hidden');
            }, 300);
            okBtn.onclick = null;
            cancelBtn.onclick = null;
        };

        okBtn.onclick = () => {
            cleanup();
            resolve(true);
        };

        cancelBtn.onclick = () => {
            cleanup();
            resolve(false);
        };
    });
};

window.toggleTaskHistory = (taskId, btn) => {
    const t = translations[currentLang];
    const el = document.getElementById(`history-${taskId}`);
    const isHidden = el.classList.contains('hidden');
    
    if (isHidden) {
        el.classList.remove('hidden');
        btn.querySelector('span').textContent = t.hideHistory || 'Hide History';
        btn.classList.add('bg-slate-100', 'text-slate-700');
    } else {
        el.classList.add('hidden');
        btn.querySelector('span').textContent = t.viewHistory || 'View History';
        btn.classList.remove('bg-slate-100', 'text-slate-700');
    }
};

window.showTaskDetail = async (taskId) => {
    // Open tasks modal if not open
    if (tasksModal.classList.contains('hidden')) {
        tasksModal.classList.remove('hidden');
        // Trigger reflow
        void tasksModal.offsetWidth;
        tasksModal.classList.remove('opacity-0');
        tasksModalContent.classList.remove('scale-95');
    }
    
    // Switch to 'all' filter to ensure task is visible
    currentTaskFilter = 'all';
    // Update tabs UI
    document.querySelectorAll('.task-tab').forEach(el => {
        if (el.dataset.tab === 'all') el.classList.add('active', 'text-blue-600', 'border-blue-600');
        else el.classList.remove('active', 'text-blue-600', 'border-blue-600');
    });

    // Load tasks and wait
    await loadTasks();
    
    // Find and scroll to task
    const taskEl = document.getElementById(`task-card-${taskId}`);
    if (taskEl) {
        taskEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Highlight effect
        taskEl.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2');
        setTimeout(() => {
            taskEl.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2');
        }, 3000);
        
        // Auto-expand details or history if needed? 
        // Maybe just expand history to show the result
        const historyBtn = taskEl.querySelector('button[onclick^="toggleTaskHistory"]');
        if (historyBtn) {
            // Check if history is already visible
            const historyEl = document.getElementById(`history-${taskId}`);
            if (historyEl && historyEl.classList.contains('hidden')) {
                toggleTaskHistory(taskId, historyBtn);
            }
        }
    }
};

// Clear Runaway Tasks
window.clearRunawayTasks = async () => {
    const t = translations[currentLang];
    if (!await showConfirm(t.confirmClearRunaway || 'Are you sure you want to stop and delete all runaway tasks? This action cannot be undone.', null, { type: 'danger' })) return;
    
    if (!window.lastTasks) {
        await loadTasks();
    }
    
    const runawayTasks = window.lastTasks.filter(task => 
        (task.status === 'in_progress' || task.status === 'running') && !task.schedule && !task.cron
    );
    
    if (runawayTasks.length === 0) {
        alert(t.noRunawayTasks || 'No runaway tasks found.');
        return;
    }
    
    // Delete tasks one by one
    let successCount = 0;
    for (const task of runawayTasks) {
        try {
            const res = await fetch(`/api/tasks/${task.id}`, {
                method: 'DELETE'
            });
            
            if (res.ok) {
                successCount++;
            } else {
                console.error(`Failed to delete task ${task.id}`);
            }
        } catch (e) {
            console.error(`Error deleting task ${task.id}:`, e);
        }
    }
    
    if (successCount > 0) {
        alert((t.clearedRunawayTasks || 'Successfully cleared {count} runaway tasks.').replace('{count}', successCount));
        loadTasks();
    } else {
        alert(t.failedClearRunaway || 'Failed to clear tasks. Please try again.');
    }
};

window.deleteTask = async (taskId) => {
    const t = translations[currentLang];
    const confirmed = await showConfirm(
        t.deleteTaskConfirm || 'Are you sure you want to permanently delete this task? This action cannot be undone.',
        t.deleteTask || 'Delete Task',
        { type: 'danger', confirmText: t.deleteTask || 'Delete' }
    );
    if (!confirmed) return;

    try {
        const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
        
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                showLogin();
                return;
            }
            throw new Error('Failed to delete');
        }
        
        loadTasks();
    } catch (err) {
        alert(t.deleteTaskError || 'Failed to delete task');
        console.error(err);
    }
};

window.clearAllTasks = async () => {
    const t = translations[currentLang];
    if (!await showConfirm(t.confirmClearAll || 'Are you sure you want to delete ALL tasks? This action cannot be undone.', null, { type: 'danger' })) return;
    
    try {
        const res = await fetch('/api/tasks', {
            method: 'DELETE'
        });
        
        if (!res.ok) {
             if (res.status === 401 || res.status === 403) {
                  showLogin();
                  return;
             }
             throw new Error(`Failed to delete all tasks: ${res.status}`);
        }
        
        loadTasks();
    } catch (e) {
        console.error('Error clearing all tasks:', e);
        alert(t.clearAllError || 'Failed to clear all tasks');
    }
};

window.restartTask = async (taskId) => {
    const t = translations[currentLang];
    if (!await showConfirm(t.restartConfirm || 'Are you sure you want to restart this task?', null, { type: 'warning' })) return;
    
    try {
        const res = await fetch(`/api/tasks/${taskId}/restart`, {
            method: 'POST'
        });
        
        if (!res.ok) {
             if (res.status === 401 || res.status === 403) {
                  showLogin();
                  return;
             }
             throw new Error(`Failed to restart task: ${res.status}`);
        }
        
        // Refresh tasks
        loadTasks();
    } catch (e) {
        console.error('Error restarting task:', e);
        alert('Failed to restart task');
    }
};

window.stopTask = async (taskId) => {
    const t = translations[currentLang];
    if (!await showConfirm(t.stopConfirm || 'Are you sure you want to stop this task?', null, { type: 'danger' })) return;
    
    try {
        const res = await fetch(`/api/tasks/${taskId}/stop`, {
            method: 'POST'
        });
        
        if (!res.ok) {
             if (res.status === 401 || res.status === 403) {
                  showLogin();
                  return;
             }
             const data = await res.json().catch(() => ({}));
             throw new Error(data.error || `Failed to stop task: ${res.status}`);
        }
        
        // Refresh tasks
        loadTasks();
    } catch (e) {
        console.error('Error stopping task:', e);
        alert(e.message || 'Failed to stop task');
    }
};

window.resumeTask = async (taskId) => {
    const t = translations[currentLang];
    if (!await showConfirm(t.resumeConfirm || 'Are you sure you want to resume this task?', null, { type: 'info' })) return;
    
    try {
        const res = await fetch(`/api/tasks/${taskId}/resume`, {
            method: 'POST'
        });
        
        if (!res.ok) {
             if (res.status === 401 || res.status === 403) {
                  showLogin();
                  return;
             }
             const data = await res.json().catch(() => ({}));
             throw new Error(data.error || `Failed to resume task: ${res.status}`);
        }
        
        // Refresh tasks
        loadTasks();
    } catch (e) {
        console.error('Error resuming task:', e);
        alert(e.message || 'Failed to resume task');
    }
};

window.runTaskOnce = async (taskId) => {
    const t = translations[currentLang];
    if (!await showConfirm(t.runOnceConfirm || 'Are you sure you want to run this task once now?', null, { type: 'info' })) return;
    
    const parseErrorMessage = async (res, fallback) => {
        try {
            const data = await res.json();
            if (data?.error) return data.error;
        } catch {
            try {
                const text = await res.text();
                if (text) return text;
            } catch {
            }
        }
        return fallback;
    };
    
    try {
        let res = await fetch(`/api/tasks/${taskId}/run-once`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });
        
        if (!res.ok && res.status === 404) {
            res = await fetch(`/api/tasks/run-once`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: taskId, sessionId })
            });
        }
        
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                showLogin();
                return;
            }
            const fallback = `Failed to run task once: ${res.status}`;
            const detail = await parseErrorMessage(res, fallback);
            throw new Error(detail);
        }
        
        loadTasks();
    } catch (e) {
        console.error('Error running task once:', e);
        const message = e?.message ? `${t.runOnceError || 'Failed to run task once'}: ${e.message}` : (t.runOnceError || 'Failed to run task once');
        alert(message);
    }
};

window.editMaxExecutions = async (taskId, currentMax) => {
    const t = translations[currentLang];
    const newMax = prompt(t.enterMaxExecutions || 'Enter new max executions (0 for infinite):', currentMax);
    
    if (newMax === null) return;
    
    const maxExecutions = parseInt(newMax, 10);
    if (isNaN(maxExecutions) || maxExecutions < 0) {
        alert(t.invalidNumber || 'Please enter a valid number');
        return;
    }

    try {
        const res = await fetch(`/api/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ max_executions: maxExecutions })
        });

        if (!res.ok) {
             if (res.status === 401 || res.status === 403) {
                  showLogin();
                  return;
             }
             throw new Error(`Failed to update task: ${res.status}`);
        }

        loadTasks();
    } catch (e) {
        console.error('Error updating task:', e);
        alert(t.updateError || 'Failed to update task');
    }
};

// Source Code Viewing
const sourceModal = document.getElementById('source-modal');
const sourceModalContent = document.getElementById('source-modal-content');

window.viewSource = async (filePath) => {
    const t = translations[currentLang];
    const sourceContent = document.getElementById('source-content');
    const sourcePath = document.getElementById('source-file-path');
    
    // Show modal
    sourceModal.classList.remove('hidden');
    void sourceModal.offsetWidth; // Trigger reflow
    sourceModal.classList.remove('opacity-0');
    sourceModalContent.classList.remove('scale-95');
    
    // Set loading state
    sourcePath.textContent = filePath;
    sourceContent.textContent = t.loadingSource || 'Loading source code...';
    // Reset classes to base state + loading
    sourceContent.className = 'p-4 font-mono text-sm whitespace-pre overflow-x-auto min-h-full text-slate-400 italic';
    sourceContent.removeAttribute('data-highlighted');
    
    try {
        const res = await fetch(`/api/files/content?path=${encodeURIComponent(filePath)}`);
        
        if (!res.ok) {
            throw new Error(`Failed to load file: ${res.status}`);
        }
        
        const data = await res.json();
        
        // Update content
        sourceContent.textContent = data.content;
        // Reset classes to base state + content color
        sourceContent.className = 'p-4 font-mono text-sm whitespace-pre overflow-x-auto min-h-full text-slate-300';
        
        // Highlight if hljs is available
        if (window.hljs) {
            window.hljs.highlightElement(sourceContent);
        }
    } catch (e) {
        console.error('Error loading source:', e);
        sourceContent.textContent = `${t.errorLoadingSource || 'Error loading source code'}: ${e.message}`;
        sourceContent.classList.remove('text-slate-400', 'italic');
        sourceContent.classList.add('text-red-500');
    }
};

window.viewTaskCode = (taskId) => {
    const task = window.lastTasks.find(t => t.id === taskId);
    if (!task || !task.content) return;

    const t = translations[currentLang];
    // Reusing the source modal
    const sourceContent = document.getElementById('source-content');
    const sourcePath = document.getElementById('source-file-path');

    // Show modal
    sourceModal.classList.remove('hidden');
    void sourceModal.offsetWidth; // Trigger reflow
    sourceModal.classList.remove('opacity-0');
    sourceModalContent.classList.remove('scale-95');

    sourcePath.textContent = `Task: ${task.name || task.id}`;
    sourceContent.textContent = task.content;
    
    // Reset classes to base state + content color
    sourceContent.className = 'p-4 font-mono text-sm whitespace-pre overflow-x-auto min-h-full text-slate-300';
    sourceContent.removeAttribute('data-highlighted');

    if (window.hljs) {
        window.hljs.highlightElement(sourceContent);
    }
};

window.closeSourceModal = () => {
    sourceModal.classList.add('opacity-0');
    sourceModalContent.classList.add('scale-95');
    setTimeout(() => {
        sourceModal.classList.add('hidden');
        document.getElementById('source-content').textContent = '';
    }, 300);
};

window.copySourceCode = () => {
    const content = document.getElementById('source-content').textContent;
    navigator.clipboard.writeText(content).then(() => {
        const btn = document.querySelector('button[onclick="copySourceCode()"] i');
        const originalClass = btn.className;
        btn.className = 'fas fa-check text-green-500';
        setTimeout(() => {
            btn.className = originalClass;
        }, 2000);
    });
};

// Close source modal on outside click
if (sourceModal) {
    sourceModal.addEventListener('click', (e) => {
        if (e.target === sourceModal) {
            closeSourceModal();
        }
    });
}

// Init
updateUIStrings();