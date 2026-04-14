/**
 * AgentOS WiFi Manager - UI Module
 * Version: 2026.5.0
 * Features: Toast notifications, modals, and UI helpers
 */

const UI = {
    // Toast notifications
    toast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-10px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    success(message, duration = 3000) { this.toast(message, 'success', duration); },
    error(message, duration = 4000) { this.toast(message, 'error', duration); },
    warning(message, duration = 3500) { this.toast(message, 'warning', duration); },
    info(message, duration = 3000) { this.toast(message, 'info', duration); },

    // Modal
    showModal(title, content) {
        const overlay = document.getElementById('modal-overlay');
        const modalTitle = document.getElementById('modal-title');
        const modalBody = document.getElementById('modal-body');
        if (!overlay || !modalTitle || !modalBody) return;
        modalTitle.textContent = title;
        modalBody.innerHTML = content;
        overlay.classList.remove('hidden');
    },

    closeModal() {
        const overlay = document.getElementById('modal-overlay');
        if (overlay) overlay.classList.add('hidden');
    },

    showQRModal(code, plan) {
        const content = `
            <div class="qr-display">
                <div style="background: white; padding: 20px; border-radius: 12px; display: inline-block;">
                    <p style="font-size: 48px; margin: 0;">🎟️</p>
                </div>
                <div class="qr-code">${code}</div>
                <p style="margin-top: 12px;">Plan: ${plan}</p>
                <p style="font-size: 12px; color: #757575; margin-top: 4px;">Use this code to connect to the network</p>
            </div>`;
        this.showModal('Voucher Created', content);
    },

    showWhatsAppQR(qr) {
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qr)}`;
        const content = `
            <div class="whatsapp-qr-container" style="text-align: center; padding: 20px;">
                <p style="margin-bottom: 16px;">Scan this code with WhatsApp to connect AgentOS</p>
                <div style="background: white; padding: 15px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                    <img src="${qrUrl}" alt="WhatsApp QR Code" style="display: block; width: 250px; height: 250px;">
                </div>
                <p style="margin-top: 16px; font-size: 14px; color: #89DDFF;">Connecting to Gateway...</p>
            </div>`;
        this.showModal('WhatsApp Login', content);
    },

    showCreateVoucherModal() {
        const plans = CONFIG.VOUCHER_PLANS;
        const planOptions = Object.entries(plans).map(([key, plan]) => `
            <div class="plan-option" data-plan="${key}" onclick="UI.selectPlan('${key}')">
                <h4>${plan.name}</h4>
                <p>$${plan.price.toFixed(2)}</p>
            </div>`).join('');

        const content = `
            <p style="margin-bottom: 16px;">Select voucher plan:</p>
            <div class="plan-options" id="plan-options">${planOptions}</div>
            <button class="btn primary" style="margin-top: 20px; width: 100%;" id="create-voucher-btn" disabled onclick="App.createVoucher()">Create Voucher</button>`;
        this.showModal('Create Voucher', content);
        this._selectedPlan = null;
    },

    selectPlan(plan) {
        document.querySelectorAll('.plan-option').forEach(el => el.classList.remove('selected'));
        const selected = document.querySelector(`.plan-option[data-plan="${plan}"]`);
        if (selected) {
            selected.classList.add('selected');
            this._selectedPlan = plan;
            document.getElementById('create-voucher-btn').disabled = false;
        }
    },

    getSelectedPlan() { return this._selectedPlan; },

    updateConnectionStatus(connected) {
        const indicator = document.getElementById('connectionStatus');
        if (indicator) {
            indicator.classList.toggle('online', connected);
            indicator.querySelector('.status-text').textContent = connected ? 'Online' : 'Offline';
        }
    },

    formatDate(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    },

    statusBadge(status) {
        const classes = { active: 'active', used: 'used', expired: 'expired', new: 'new' };
        const labels = { active: 'Active', used: 'Used', expired: 'Expired', new: 'New' };
        return `<span class="voucher-status ${classes[status] || ''}">${labels[status] || status}</span>`;
    },

    renderVoucherItem(voucher) {
        let status = 'new';
        if (voucher.used) status = 'used';
        else if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) status = 'expired';
        else status = 'active';

        return `<div class="voucher-item">
            <div class="voucher-info">
                <h4>${voucher.code}</h4>
                <p>Plan: ${voucher.plan} | Created: ${this.formatDate(voucher.created_at)}</p>
            </div>
            ${this.statusBadge(status)}
        </div>`;
    },

    renderUserItem(user, isActive = false) {
        return `<div class="user-item">
            <div>
                <div class="user-name">${user.name || user.user || 'Unknown'}</div>
                <div class="user-details">${user.address ? `IP: ${user.address} | ` : ''}${user.uptime ? `Uptime: ${user.uptime}` : ''}${user.profile ? `Profile: ${user.profile}` : ''}</div>
            </div>
            ${isActive ? `<div class="user-actions"><button class="user-action-btn kick" onclick="App.kickUser('${user.user || user.name}')">Kick</button></div>` : ''}
        </div>`;
    }
};

if (typeof window !== 'undefined') window.UI = UI;
