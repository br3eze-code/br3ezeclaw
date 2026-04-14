let recording = false;
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'TOGGLE_RECORD') { recording = msg.recording; if (recording) startRecord(); else stopRecord(); }
});
function cssSelector(el) {
  if (el.id) return '#' + el.id; if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
  if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]';
  let path = []; while (el && el.nodeType === 1 && path.length < 4) { let selector = el.tagName.toLowerCase(); if (el.className && typeof el.className === 'string') { const cls = el.className.trim().split(/\s+/)[0]; if (cls) selector += '.' + cls; } path.unshift(selector); el = el.parentNode; } return path.join(' > ');
}
function startRecord() { document.addEventListener('click', recordClick, true); document.addEventListener('input', recordInput, true); showBanner('🔴 AgentOS Recording - Click elements'); }
function stopRecord() { document.removeEventListener('click', recordClick, true); document.removeEventListener('input', recordInput, true); hideBanner(); }
function recordClick(e) { if (!recording || e.target.id === 'agentos-banner') return; e.preventDefault(); e.stopPropagation(); const sel = cssSelector(e.target); chrome.runtime.sendMessage({ type: 'ADD_ACTION', action: { type: 'click', selector: sel } }); flashElement(e.target); }
function recordInput(e) { if (!recording) return; if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') { const sel = cssSelector(e.target); chrome.runtime.sendMessage({ type: 'ADD_ACTION', action: { type: 'type', selector: sel, value: e.target.value } }); } }
function flashElement(el) { const old = el.style.outline; el.style.outline = '2px solid #3b82f6'; setTimeout(() => el.style.outline = old, 400); }
function showBanner(text) { if (document.getElementById('agentos-banner')) return; const div = document.createElement('div'); div.id = 'agentos-banner'; div.textContent = text; div.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);background:#dc2626;color:#fff;padding:6px 12px;z-index:999999;font-family:system-ui;font-size:13px;border-radius:0 0 6px 6px;'; document.body.appendChild(div); }
function hideBanner() { document.getElementById('agentos-banner')?.remove(); }
