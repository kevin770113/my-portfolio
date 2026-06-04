import { state } from './state.js';

// ==========================================
// 基礎工具與導航 (Utilities & Navigation)
// ==========================================
export function openDrawer() { document.getElementById('drawer-overlay').classList.add('show'); }
export function closeDrawer() { document.getElementById('drawer-overlay').classList.remove('show'); }
export function navigateTo(url) { 
    if (window.location.href.includes(url) || (url === 'index.html' && window.location.pathname.endsWith('/'))) { closeDrawer(); return; } 
    closeDrawer(); 
    setTimeout(() => { document.body.classList.add('fade-out'); setTimeout(() => { window.location.href = url; }, 400); }, 250); 
}

export const fmtMoney = (n) => state.isPrivacyMode ? '****' : Math.round(n).toLocaleString();

export const parseNum = (str) => { 
    if (!str) return 0; 
    const val = parseFloat(str.toString().replace(/,/g, '').replace('%', '')); 
    return isNaN(val) ? 0 : val; 
};

export const setLoading = (show, msg="正在分析金融數據...") => { 
    const textEl = document.getElementById('loading-text');
    if (textEl) textEl.innerText = msg; 
    const overlayEl = document.getElementById('loading-overlay');
    if (overlayEl) overlayEl.style.display = show ? 'flex' : 'none'; 
};

export const generateId = () => Math.random().toString(36).substr(2, 9);

let toastTimeout;
export function showToast(msg) { 
    const toast = document.getElementById('toast-container'); 
    if (!toast) return;
    toast.innerText = msg; 
    toast.classList.add('show'); 
    clearTimeout(toastTimeout); 
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500); 
}

// ==========================================
// 彈窗系統 (Modals)
// ==========================================
export let confirmCallback = null;
export function openConfirmModal(title, desc, btnText, callback) { 
    document.getElementById('confirm-modal-title').innerText = title; 
    document.getElementById('confirm-modal-desc').innerHTML = desc; 
    document.getElementById('btn-confirm-danger').innerText = btnText; 
    confirmCallback = callback; 
    document.getElementById('confirm-modal-overlay').classList.add('active'); 
}
export function closeConfirmModal() { 
    document.getElementById('confirm-modal-overlay').classList.remove('active'); 
}

export let promptCallback = null;
export function openScenPrompt(title, defaultText, callback) { 
    document.getElementById('scen-prompt-title').innerText = title; 
    document.getElementById('scen-prompt-input').value = defaultText || ''; 
    promptCallback = callback; 
    document.getElementById('scen-prompt-modal').classList.add('active'); 
    setTimeout(() => document.getElementById('scen-prompt-input').focus(), 100); 
}
export function closeScenPrompt() { 
    document.getElementById('scen-prompt-modal').classList.remove('active'); 
}

export let infoCallback = null;
export function showInfoModal(title, desc, isError = false, callback = null) { 
    document.getElementById('info-modal-title').innerText = title; 
    document.getElementById('info-modal-desc').innerHTML = desc; 
    let icon = document.getElementById('info-modal-icon');
    if(isError) { 
        icon.innerText = '!'; 
        icon.style.background = '#FDECEA'; 
        icon.style.color = '#B25858'; 
    } else { 
        icon.innerText = '✓'; 
        icon.style.background = '#E8F5E9'; 
        icon.style.color = '#4E8765'; 
    }
    infoCallback = callback; 
    document.getElementById('info-modal-overlay').classList.add('active'); 
}
export function closeInfoModal() { 
    document.getElementById('info-modal-overlay').classList.remove('active'); 
    if (infoCallback) { 
        let cb = infoCallback; 
        infoCallback = null; 
        cb(); 
    } 
}
