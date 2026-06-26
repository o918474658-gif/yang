// ==========================================================================
// app.js - 發票與出差旅費整理統計工具核心邏輯
// ==========================================================================

// Global App State
const state = {
    invoices: [],
    settings: {
        apiKey: '',
        model: 'gemini-3.5-flash'
    },
    serverHasKey: false, // 標記伺服器端是否有設定環境變數金鑰
    currentMonth: '', // YYYY-MM
    selectedImageBase64: null, // For previewing/submitting currently uploaded image
    activeTab: 'dashboard',
    editMode: false,
    cameraStream: null,
    reports: []
};

// ==========================================================================
// Initialization
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Month (Default to 2026-06)
    state.currentMonth = '2026-06';
    
    // Set global month filter input
    const monthFilter = document.getElementById('globalMonthFilter');
    monthFilter.value = '2026-06';

    // Set default values for Travel Report Control Panel
    document.getElementById('repYear').value = 115;
    document.getElementById('repMonth').value = 6;
    
    // Set default date range
    document.getElementById('repDateRangeStart').value = '2026-06-01';
    document.getElementById('repDateRangeEnd').value = '2026-06-30';
    document.getElementById('repPurpose').value = '團體健身教課';
    document.getElementById('repEmployee').value = '林憶杰';
    document.getElementById('repLocation').value = '台北';

    // 2. Load settings, invoices and reports from localStorage
    loadSettings();
    loadInvoices();
    loadReports();
    checkServerConfig(); // 檢查後端環境變數配置

    // 3. Bind UI Events
    initEventListeners();

    // 4. Render Initial Dashboard & Tables
    updateDashboardStats();
    renderRecentInvoices();
    renderInvoiceTable();
    updateTravelReportPreview(true); // 初始化並填入發票明細車費

    // 強制設定使用者要求的預設值
    document.getElementById('repTrainCostInput').value = 500;
    document.getElementById('repCarCostInput').value = 0;
    document.getElementById('repOtherCostInput').value = 0;
    updateTravelReportPreview(false); // 更新預覽以反映 500 元車費
    
    // 初始化差旅表單日期為當月第一天
    const travelDateEl = document.getElementById('travelDate');
    if (travelDateEl) {
        travelDateEl.value = '2026-06-01';
    }
    
    // 初始化差旅交通欄位狀態
    toggleTravelTransportFields();
    
    // Render Saved Reports Table
    renderReportsTable();
    
    // Lucide Icons initialization
    lucide.createIcons();

    // 動態縮放報告表預覽圖（讓圖表隨視窗大小自動縮放）
    function scaleReportPreview() {
        const container = document.querySelector('.report-col-middle .report-preview-container');
        const report = document.getElementById('printableReportArea');
        if (!container || !report) return;

        const PAPER_WIDTH = 1000; // 報告表原始寬度 px
        const containerWidth = container.clientWidth;
        const padding = 20; // 容器內留白
        const scale = Math.min(1, (containerWidth - padding) / PAPER_WIDTH);

        report.style.transform = `scale(${scale})`;
        // 設定容器高度以配合縮放後的圖表高度
        const reportHeight = report.scrollHeight || 600;
        container.style.height = Math.ceil(reportHeight * scale + padding) + 'px';
    }
    window._scaleReportPreview = scaleReportPreview; // 讓其他函數可呼叫

    // 初次執行 & 監聽視窗大小改變
    setTimeout(scaleReportPreview, 100);
    window.addEventListener('resize', scaleReportPreview);

});

// ==========================================================================
// Settings Management
// ==========================================================================
function loadSettings() {
    const saved = localStorage.getItem('invoice_helper_settings');
    if (saved) {
        try {
            state.settings = JSON.parse(saved);
        } catch (e) {
            console.error('Failed to parse settings', e);
        }
    }
    // Update API Warning visibility
    toggleApiWarning();
}

function saveSettings(key, model) {
    state.settings.apiKey = key.trim();
    state.settings.model = model;
    localStorage.setItem('invoice_helper_settings', JSON.stringify(state.settings));
    toggleApiWarning();
}

async function checkServerConfig() {
    try {
        const response = await fetch('/api/config');
        if (response.ok) {
            const config = await response.json();
            state.serverHasKey = !!config.serverHasKey;
            if (config.defaultModel) {
                if (!state.settings.model) {
                    state.settings.model = config.defaultModel;
                }
            }
        }
    } catch (e) {
        console.warn('無法連線至 /api/config，可能非 Python 伺服器環境：', e);
    }
    toggleApiWarning();
}

function toggleApiWarning() {
    const banner = document.getElementById('apiWarningBanner');
    if (state.settings.apiKey || state.serverHasKey) {
        banner.classList.add('hidden');
    } else {
        banner.classList.remove('hidden');
    }
}

// ==========================================================================
// Data Persistence (LocalStorage CRUD)
// ==========================================================================
function loadInvoices() {
    const saved = localStorage.getItem('invoice_helper_items');
    if (saved) {
        try {
            state.invoices = JSON.parse(saved);
        } catch (e) {
            console.error('Failed to parse invoices', e);
            state.invoices = [];
        }
    } else {
        // Mock data to ensure UX looks rich from the start (Design Aesthetics)
        state.invoices = getMockInvoices();
        saveInvoicesToStorage();
    }
}

function saveInvoicesToStorage() {
    localStorage.setItem('invoice_helper_items', JSON.stringify(state.invoices));
}

function addInvoice(item) {
    state.invoices.push(item);
    saveInvoicesToStorage();
    refreshAllViews();
}

function updateInvoice(id, updatedItem) {
    const index = state.invoices.findIndex(item => item.id === id);
    if (index !== -1) {
        state.invoices[index] = { ...state.invoices[index], ...updatedItem };
        saveInvoicesToStorage();
        refreshAllViews();
    }
}

function deleteInvoice(id) {
    state.invoices = state.invoices.filter(item => item.id !== id);
    saveInvoicesToStorage();
    refreshAllViews();
}

function refreshAllViews() {
    updateDashboardStats();
    renderRecentInvoices();
    renderInvoiceTable();
    updateTravelReportPreview(true); // 明細變更時，重新計算並覆蓋車費輸入框
}

// ==========================================================================
// Event Listeners Setup
// ==========================================================================
function initEventListeners() {
    // Tab Navigation
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            const tabId = item.getAttribute('data-tab');
            switchTab(tabId);
        });
    });

    // Global Month Filter
    document.getElementById('globalMonthFilter').addEventListener('change', (e) => {
        state.currentMonth = e.target.value;
        
        // Auto-update Travel Report Dates when global month changes
        if (state.currentMonth) {
            const [yr, mo] = state.currentMonth.split('-');
            const yearNum = parseInt(yr);
            const monthNum = parseInt(mo);
            
            document.getElementById('repYear').value = yearNum - 1911;
            document.getElementById('repMonth').value = monthNum;
            
            const lastDay = new Date(yearNum, monthNum, 0).getDate();
            document.getElementById('repDateRangeStart').value = `${yr}-${mo}-01`;
            document.getElementById('repDateRangeEnd').value = `${yr}-${mo}-${String(lastDay).padStart(2, '0')}`;
        }
        
        refreshAllViews();
    });

    // API Settings Modal triggers
    document.getElementById('openSettingsBtn').addEventListener('click', openSettingsModal);
    document.getElementById('closeSettingsBtn').addEventListener('click', closeSettingsModal);
    document.getElementById('cancelSettingsBtn').addEventListener('click', closeSettingsModal);
    document.getElementById('saveSettingsBtn').addEventListener('click', saveSettingsFromForm);

    // Camera Modal triggers
    document.getElementById('quickCameraBtn').addEventListener('click', openCamera);
    document.getElementById('closeCameraBtn').addEventListener('click', closeCamera);
    document.getElementById('cancelCameraBtn').addEventListener('click', closeCamera);
    document.getElementById('captureBtn').addEventListener('click', capturePhoto);

    // Form inputs and triggers
    document.getElementById('invType').addEventListener('change', toggleTransportFields);
    document.getElementById('invoiceForm').addEventListener('submit', handleInvoiceFormSubmit);
    document.getElementById('resetFormBtn').addEventListener('click', resetInvoiceForm);
    
    // File inputs for OCR
    setupDragAndDrop('quickDropzone', 'quickFileInput', handleFileUploaded);
    setupDragAndDrop('listDropzone', 'listFileInput', handleFileUploaded);
    
    // Remove image preview button
    document.getElementById('removePreviewBtn').addEventListener('click', removeImagePreview);
    
    // Manual trigger for OCR
    document.getElementById('btnTriggerOcr').addEventListener('click', () => {
        if (state.selectedImageBase64) {
            runGeminiOcr(state.selectedImageBase64);
        }
    });

    // View all invoices helper in dashboard
    document.getElementById('viewAllInvoicesBtn').addEventListener('click', () => {
        document.querySelector('.nav-item[data-tab="invoice-list"]').click();
    });

    // Invoice list Table filters & export
    document.getElementById('filterType').addEventListener('change', renderInvoiceTable);
    document.getElementById('exportCsvBtn').addEventListener('click', exportToCsv);

    // Travel Report Control Panel changes -> Instant Preview (Manual inputs, no auto-fill overwrite)
    const reportInputs = [
        'repYear', 'repMonth', 'repPurpose', 'repEmployee', 'repLocation',
        'repTrainCostInput', 'repCarCostInput', 'repOtherCostInput',
        'repMealDays', 'repMealRate', 'repStayDays', 'repStayRate', 'repMemo'
    ];
    reportInputs.forEach(id => {
        document.getElementById(id).addEventListener('input', () => updateTravelReportPreview(false));
    });

    // When date range changes, automatically recalculate and fill in the transport costs
    document.getElementById('repDateRangeStart').addEventListener('change', () => updateTravelReportPreview(true));
    document.getElementById('repDateRangeEnd').addEventListener('change', () => updateTravelReportPreview(true));
    // 填表日期變更時即時更新預覽
    document.getElementById('repReportDate').addEventListener('change', () => updateTravelReportPreview(false));

    // Print Travel Report Button
    document.getElementById('btnPrintReport').addEventListener('click', () => {
        let printStyle = document.getElementById('print-layout-style');
        if (!printStyle) {
            printStyle = document.createElement('style');
            printStyle.id = 'print-layout-style';
            document.head.appendChild(printStyle);
        }
        printStyle.innerHTML = '@page { size: landscape; margin: 15mm; }';
        window.print();
    });

    // 差旅憑證新增表單與連動事件
    const travelForm = document.getElementById('travelExpenseForm');
    if (travelForm) {
        travelForm.addEventListener('submit', handleTravelFormSubmit);
    }
    const travelTypeSelect = document.getElementById('travelType');
    if (travelTypeSelect) {
        travelTypeSelect.addEventListener('change', toggleTravelTransportFields);
    }

    // 儲存報告表按鈕
    const saveReportBtn = document.getElementById('btnSaveReport');
    if (saveReportBtn) {
        saveReportBtn.addEventListener('click', handleSaveReport);
    }

    // 合併列印所選按鈕
    const batchPrintBtn = document.getElementById('btnBatchPrintReports');
    if (batchPrintBtn) {
        batchPrintBtn.addEventListener('click', handleBatchPrintReports);
    }

    // 全選/取消全選報告表
    const chkAllReports = document.getElementById('chkSelectAllReports');
    if (chkAllReports) {
        chkAllReports.addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('#savedReportsTableBody .report-checkbox');
            checkboxes.forEach(cb => cb.checked = e.target.checked);
        });
    }

    // 安全登出按鈕
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
}

// Switch tabs logic
function switchTab(tabId) {
    state.activeTab = tabId;
    
    // Hide all contents
    const contents = document.querySelectorAll('.tab-content');
    contents.forEach(c => c.classList.remove('active'));
    
    // Show active content
    document.getElementById(`tab-${tabId}`).classList.add('active');
    
    // Update Header Text
    const title = document.getElementById('pageTitle');
    const subtitle = document.getElementById('pageSubtitle');
    
    if (tabId === 'dashboard') {
        title.innerText = '儀表板';
        subtitle.innerText = '歡迎使用！在這裡查看您的發票整理進度與統計資訊。';
    } else if (tabId === 'invoice-list') {
        title.innerText = '發票明細管理';
        subtitle.innerText = '新增或上傳發票與憑證，並在此管理所有明細。';
    } else if (tabId === 'travel-report') {
        title.innerText = '出差旅費報告表';
        subtitle.innerText = '依據所選期間的交通費自動填寫，提供您符合標準的旅費申報表。';
    }
}

// ==========================================================================
// Dashboard Stats Rendering
// ==========================================================================
function updateDashboardStats() {
    const filtered = getInvoicesForCurrentMonth();
    
    let inwardTotal = 0;
    let inwardCount = 0;
    let outwardTotal = 0;
    let outwardCount = 0;
    let travelTotal = 0;
    let travelCount = 0;
    let totalReimburse = 0;
    let totalCount = 0;

    filtered.forEach(item => {
        if (item.type === '進項') {
            inwardTotal += item.amount;
            inwardCount++;
        } else if (item.type === '銷項') {
            outwardTotal += item.amount;
            outwardCount++;
        } else if (item.type === '交通費') {
            travelTotal += item.amount;
            travelCount++;
            totalReimburse += item.amount;
            totalCount++;
        } else {
            // Other reimbursement categories (stay, food, other)
            totalReimburse += item.amount;
            totalCount++;
        }
    });

    // 預估應納營業稅計算 (台灣營業稅率 5%，金額預設為含稅)
    // 銷項稅額 = 銷項總額 * 5 / 105
    // 進項稅額 = (進項發票總額 + 所有差旅報銷支出) * 5 / 105
    const outwardTax = Math.round(outwardTotal * 5 / 105);
    const inwardTax = Math.round((inwardTotal + totalReimburse) * 5 / 105);
    const estimatedVat = outwardTax > inwardTax ? (outwardTax - inwardTax) : 0;

    document.getElementById('statInwardAmount').innerText = `$${inwardTotal.toLocaleString()}`;
    document.getElementById('statInwardCount').innerText = `${inwardCount} 張發票`;
    
    document.getElementById('statOutwardAmount').innerText = `$${outwardTotal.toLocaleString()}`;
    document.getElementById('statOutwardCount').innerText = `${outwardCount} 張發票`;

    document.getElementById('statTravelAmount').innerText = `$${travelTotal.toLocaleString()}`;
    document.getElementById('statTravelCount').innerText = `${travelCount} 筆憑證`;

    document.getElementById('statTotalReimburse').innerText = `$${totalReimburse.toLocaleString()}`;
    document.getElementById('statTotalCount').innerText = `共 ${totalCount} 筆明細`;

    document.getElementById('statTaxAmount').innerText = `$${estimatedVat.toLocaleString()}`;
    document.getElementById('statTaxFormula').innerText = `銷項稅: $${outwardTax.toLocaleString()} - 進項稅: $${inwardTax.toLocaleString()} (5%)`;
}

function renderRecentInvoices() {
    const list = document.getElementById('recentInvoicesList');
    list.innerHTML = '';
    
    // Sort all by date descending, grab top 5
    const sorted = [...state.invoices]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5);

    if (sorted.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <i data-lucide="inbox"></i>
                <p>目前尚無任何發票明細</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    sorted.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'recent-item';
        
        let typeClass = 'type-other';
        let iconName = 'receipt';
        
        if (item.type === '進項') { typeClass = 'type-inward'; iconName = 'arrow-down-left'; }
        else if (item.type === '銷項') { typeClass = 'type-outward'; iconName = 'arrow-up-right'; }
        else if (item.type === '交通費') { typeClass = 'type-travel'; iconName = 'train'; }
        else if (item.type === '住宿費') { typeClass = 'type-travel'; iconName = 'hotel'; }
        else if (item.type === '膳費') { typeClass = 'type-travel'; iconName = 'utensils'; }

        itemEl.innerHTML = `
            <div class="item-left">
                <div class="item-icon-box ${typeClass}">
                    <i data-lucide="${iconName}"></i>
                </div>
                <div class="item-main">
                    <span class="item-title">${escapeHtml(item.detail)}</span>
                    <span class="item-meta">${item.date} | ${item.type}${item.invoiceNumber ? ` | 號碼: ${item.invoiceNumber}` : ''}</span>
                </div>
            </div>
            <div class="item-right">
                <span class="item-price">$${item.amount.toLocaleString()}</span>
            </div>
        `;
        list.appendChild(itemEl);
    });
    lucide.createIcons();
}

// ==========================================================================
// Invoice Form & Workspace CRUD Rendering
// ==========================================================================
function toggleTransportFields() {
    const typeSelect = document.getElementById('invType');
    const transFields = document.getElementById('transportFields');
    if (!transFields) return; // 保護，以防被移除
    
    if (typeSelect.value === '交通費') {
        transFields.classList.remove('hidden');
    } else {
        transFields.classList.add('hidden');
        const transLocationEl = document.getElementById('transLocation');
        if (transLocationEl) transLocationEl.value = '台北';
    }
}

// 差旅明細表單之交通工具顯示與隱藏連動
function toggleTravelTransportFields() {
    const typeSelect = document.getElementById('travelType');
    const transFields = document.getElementById('travelTransFields');
    if (!typeSelect || !transFields) return;
    
    if (typeSelect.value === '交通費') {
        transFields.classList.remove('hidden');
    } else {
        transFields.classList.add('hidden');
        const travelLocationEl = document.getElementById('travelLocation');
        if (travelLocationEl) travelLocationEl.value = '台北';
    }
}

// 處理差旅表單的提交
function handleTravelFormSubmit(e) {
    e.preventDefault();
    
    const date = document.getElementById('travelDate').value;
    const type = document.getElementById('travelType').value;
    const detail = document.getElementById('travelDetail').value;
    const amount = parseInt(document.getElementById('travelAmount').value, 10);
    
    const itemData = {
        id: Date.now().toString() + Math.floor(Math.random() * 1000),
        date,
        type,
        invoiceNumber: '', // 差旅憑證預設無號碼
        detail,
        amount
    };
    
    if (type === '交通費') {
        itemData.transport = document.getElementById('travelTransType').value;
        itemData.location = document.getElementById('travelLocation').value || '台北';
    }
    
    // 儲存明細
    addInvoice(itemData);
    
    // 清空輸入框（保留日期以便連續記錄）
    document.getElementById('travelDetail').value = '';
    document.getElementById('travelAmount').value = '';
    
    // 將焦點移回品名輸入框
    document.getElementById('travelDetail').focus();
    
    // 提示
    alert(`成功新增一筆「${type}」明細至當月清單！`);
}

function handleInvoiceFormSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('editInvoiceId').value;
    const date = document.getElementById('invDate').value;
    const type = document.getElementById('invType').value;
    const invoiceNumber = document.getElementById('invNumber').value;
    const detail = document.getElementById('invDetail').value;
    const amount = parseInt(document.getElementById('invAmount').value, 10);
    
    const itemData = {
        date,
        type,
        invoiceNumber,
        detail,
        amount
    };

    const transTypeEl = document.getElementById('transType');
    const transLocEl = document.getElementById('transLocation');
    if (type === '交通費' && transTypeEl && transLocEl) {
        itemData.transport = transTypeEl.value;
        itemData.location = transLocEl.value || '台北';
    } else if (state.editMode && id) {
        // 保留原本可能存在的交通費與目的地屬性
        const oldItem = state.invoices.find(inv => inv.id === id);
        if (oldItem && oldItem.type === '交通費') {
            itemData.transport = oldItem.transport;
            itemData.location = oldItem.location;
        }
    }

    if (state.editMode && id) {
        updateInvoice(id, itemData);
    } else {
        // Add new
        itemData.id = Date.now().toString() + Math.floor(Math.random() * 1000);
        addInvoice(itemData);
    }

    resetInvoiceForm();
}

function resetInvoiceForm() {
    document.getElementById('invoiceForm').reset();
    document.getElementById('editInvoiceId').value = '';
    document.getElementById('formTitle').innerText = '新增發票 / 憑證';
    document.getElementById('saveInvoiceBtn').innerHTML = '<i data-lucide="check"></i> 儲存明細';
    
    // 清除臨時選項
    const typeSelect = document.getElementById('invType');
    if (typeSelect) {
        for (let i = typeSelect.options.length - 1; i >= 0; i--) {
            if (typeSelect.options[i].getAttribute('data-temp') === 'true') {
                typeSelect.remove(i);
            }
        }
    }

    removeImagePreview();
    toggleTransportFields();
    state.editMode = false;
    lucide.createIcons();
}

function fillFormForEdit(id) {
    const item = state.invoices.find(inv => inv.id === id);
    if (!item) return;

    state.editMode = true;
    document.getElementById('editInvoiceId').value = item.id;
    document.getElementById('formTitle').innerText = '編輯發票 / 憑證';
    document.getElementById('saveInvoiceBtn').innerHTML = '<i data-lucide="check"></i> 更新明細';

    document.getElementById('invDate').value = item.date;
    
    // 動態添加臨時選項以支援編輯舊差旅資料
    const typeSelect = document.getElementById('invType');
    if (typeSelect) {
        for (let i = typeSelect.options.length - 1; i >= 0; i--) {
            if (typeSelect.options[i].getAttribute('data-temp') === 'true') {
                typeSelect.remove(i);
            }
        }
        if (item.type !== '進項' && item.type !== '銷項') {
            const tempOpt = document.createElement('option');
            tempOpt.value = item.type;
            tempOpt.innerText = item.type === '交通費' ? '交通憑證' : (item.type === '住宿費' ? '住宿費' : (item.type === '膳費' ? '膳費' : '其他憑證'));
            tempOpt.setAttribute('data-temp', 'true');
            typeSelect.appendChild(tempOpt);
        }
        typeSelect.value = item.type;
    }
    
    document.getElementById('invNumber').value = item.invoiceNumber || '';
    document.getElementById('invDetail').value = item.detail;
    document.getElementById('invAmount').value = item.amount;

    toggleTransportFields();

    const transTypeEl = document.getElementById('transType');
    const transLocEl = document.getElementById('transLocation');
    if (item.type === '交通費' && transTypeEl && transLocEl) {
        transTypeEl.value = item.transport || '火車';
        transLocEl.value = item.location || '台北';
    }

    // Scroll back to form top
    document.getElementById('tab-invoice-list').scrollIntoView({ behavior: 'smooth' });
    lucide.createIcons();
}

function renderInvoiceTable() {
    const tbody = document.getElementById('invoiceTableBody');
    const emptyState = document.getElementById('tableEmptyState');
    tbody.innerHTML = '';

    const filterType = document.getElementById('filterType').value;
    const filteredByMonth = getInvoicesForCurrentMonth();
    
    const finalFiltered = filteredByMonth.filter(item => {
        if (filterType === 'all') return true;
        return item.type === filterType;
    });

    if (finalFiltered.length === 0) {
        emptyState.classList.remove('hidden');
        document.getElementById('listTotalCount').innerText = '0 筆';
        document.getElementById('tableFilteredTotal').innerText = '$0';
        return;
    }

    emptyState.classList.add('hidden');
    document.getElementById('listTotalCount').innerText = `${finalFiltered.length} 筆`;

    let totalSum = 0;
    finalFiltered.forEach(item => {
        totalSum += item.amount;
        
        const tr = document.createElement('tr');
        
        let detailText = escapeHtml(item.detail);
        let transDetail = '-';
        if (item.type === '交通費') {
            const loc = item.location || '台北';
            const trans = item.transport || '火車';
            transDetail = `<span class="badge ai-badge">${trans}</span> ${escapeHtml(loc)}`;
        }

        tr.innerHTML = `
            <td>${item.date}</td>
            <td><span class="badge ${getTypeBadgeClass(item.type)}">${item.type}</span></td>
            <td><code>${escapeHtml(item.invoiceNumber || '-')}</code></td>
            <td>${detailText}</td>
            <td>${transDetail}</td>
            <td class="text-right font-bold">$${item.amount.toLocaleString()}</td>
            <td class="text-center">
                <div class="action-buttons">
                    <button class="btn-table-edit" onclick="editItemDirect('${item.id}')" title="編輯">
                        <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
                    </button>
                    <button class="btn-table-delete" onclick="deleteItemDirect('${item.id}')" title="刪除">
                        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('tableFilteredTotal').innerText = `$${totalSum.toLocaleString()}`;
    lucide.createIcons();
}

// Helpers called from window context because of inline attributes
window.editItemDirect = function(id) {
    fillFormForEdit(id);
};

window.deleteItemDirect = function(id) {
    if (confirm('確定要刪除此筆發票明細嗎？')) {
        deleteInvoice(id);
    }
};

function getTypeBadgeClass(type) {
    if (type === '進項') return 'type-inward';
    if (type === '銷項') return 'type-outward';
    if (type === '交通費') return 'type-travel';
    return 'type-other';
}

// ==========================================================================
// File Drag-Drop & File Uploader Setup
// ==========================================================================
function setupDragAndDrop(zoneId, inputId, onFileCallback) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);

    zone.addEventListener('click', () => input.click());
    
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            onFileCallback(e.dataTransfer.files[0]);
        }
    });

    input.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            onFileCallback(e.target.files[0]);
        }
    });
}

function handleFileUploaded(file) {
    if (!file.type.startsWith('image/')) {
        alert('請上傳圖片格式檔案 (JPG, PNG)。');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        const base64Str = event.target.result;
        state.selectedImageBase64 = base64Str;
        
        // Show in sidebar preview inside list view
        const imgPreview = document.getElementById('imagePreview');
        imgPreview.src = base64Str;
        
        document.getElementById('imagePreviewContainer').classList.remove('hidden');
        document.getElementById('btnTriggerOcr').classList.remove('hidden');

        // If uploaded from dashboard quick dropzone, automatically redirect to list page and trigger OCR
        if (state.activeTab === 'dashboard') {
            document.querySelector('.nav-item[data-tab="invoice-list"]').click();
        }
        
        // Auto-trigger OCR if API Key is configured
        if (state.settings.apiKey || state.serverHasKey) {
            runGeminiOcr(base64Str);
        } else {
            alert('圖片上傳成功！請先在左下角設定 Gemini API Key 或設定伺服器環境變數以自動辨識發票資訊。您也可以點擊下方按鈕手動輸入。');
        }
    };
    reader.readAsDataURL(file);
}

function removeImagePreview() {
    state.selectedImageBase64 = null;
    document.getElementById('imagePreview').src = '';
    document.getElementById('imagePreviewContainer').classList.add('hidden');
    document.getElementById('btnTriggerOcr').classList.add('hidden');
    
    // Clear inputs in file uploaders
    document.getElementById('quickFileInput').value = '';
    document.getElementById('listFileInput').value = '';
}

// ==========================================================================
// WebRTC Camera Integration
// ==========================================================================
async function openCamera() {
    const modal = document.getElementById('cameraModal');
    const video = document.getElementById('cameraVideo');
    
    try {
        state.cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        video.srcObject = state.cameraStream;
        modal.classList.add('active');
    } catch (err) {
        console.error('Error accessing camera', err);
        alert('無法存取相機，請檢查瀏覽器權限或使用上傳圖片方式。');
    }
}

function closeCamera() {
    const modal = document.getElementById('cameraModal');
    const video = document.getElementById('cameraVideo');
    
    if (state.cameraStream) {
        state.cameraStream.getTracks().forEach(track => track.stop());
        state.cameraStream = null;
    }
    video.srcObject = null;
    modal.classList.remove('active');
}

function capturePhoto() {
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('cameraCanvas');
    const ctx = canvas.getContext('2d');
    
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const base64Str = canvas.toDataURL('image/jpeg');
        state.selectedImageBase64 = base64Str;
        
        // Show in sidebar preview inside list view
        const imgPreview = document.getElementById('imagePreview');
        imgPreview.src = base64Str;
        
        document.getElementById('imagePreviewContainer').classList.remove('hidden');
        document.getElementById('btnTriggerOcr').classList.remove('hidden');
        
        // Close camera stream
        closeCamera();
        
        // Switch tab to list view
        document.querySelector('.nav-item[data-tab="invoice-list"]').click();
        
        // Run OCR if API is set
        if (state.settings.apiKey || state.serverHasKey) {
            runGeminiOcr(base64Str);
        } else {
            alert('拍照成功！請先在左下角設定 Gemini API Key 或設定伺服器環境變數以啟用自動辨識。');
        }
    }
}

// ==========================================================================
// Gemini API Integration (OCR)
// ==========================================================================
async function runGeminiOcr(base64DataUrl) {
    const apiKey = state.settings.apiKey;
    const model = state.settings.model || 'gemini-3.5-flash';
    
    if (!apiKey && !state.serverHasKey) {
        alert('尚未設定 Gemini API Key，請點選左下角設定。');
        return;
    }

    // Show Loader
    const loader = document.getElementById('ocrLoader');
    const statusText = document.getElementById('ocrStatusText');
    loader.classList.remove('hidden');
    statusText.innerText = 'AI 智慧辨識中...';

    try {
        // Strip data prefix from base64 string
        const base64Data = base64DataUrl.split(',')[1];
        const mimeType = base64DataUrl.split(',')[0].split(':')[1].split(';')[0];
        
        const payload = {
            model: model, // 提供給後端做代理路由轉發判定
            contents: [
                {
                    parts: [
                        {
                            text: `你是一個專業的台灣發票與收據辨識助手。你的任務是從使用者上傳的發票、購物收據、加油發票或辦公耗材憑證中，精準提取資訊。
請一律以繁體中文回答。請辨識並分析圖片，以 JSON 格式回傳，欄位限制如下：
{
  "date": "YYYY-MM-DD 格式的日期。如果發票上是民國年（例如 115 年 6 月 25 日），請自動轉換為西元年 2026-06-25。如果完全找不到日期，回傳當天日期 ${new Date().toISOString().split('T')[0]}",
  "invoiceNumber": "發票號碼，如 AB-12345678。如果是無發票號碼的收據，請回傳空字串 \"\"",
  "type": "分類，只能是以下之一：'進項'（收到的發票/消費憑證，如加油、採購、文具、餐飲等）、'銷項'（公司開出去的發票）。請務必只在這兩者中選擇。",
  "detail": "品名或事由描述，必須是繁體中文。例如：「加油費」、「文具採購」、「餐飲消費」、「電腦周邊耗材」",
  "amount": 總金額（必須是整數數字，例如 1200）
}`
                        },
                        {
                            inlineData: {
                                mimeType: mimeType,
                                data: base64Data
                            }
                        }
                    ]
                }
            ],
            generationConfig: {
                responseMimeType: "application/json"
            }
        };

        let response;
        if (state.serverHasKey) {
            // 透過伺服器代理呼叫
            response = await fetch('/api/gemini', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
        } else {
            // 退回到前端直連 Google API 模式
            const localPayload = { ...payload };
            delete localPayload.model; // 移除後端專用欄位
            
            response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(localPayload)
            });
        }

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || `HTTP error ${response.status}`);
        }

        const resData = await response.json();
        const jsonText = resData.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!jsonText) {
            throw new Error('Gemini 回傳了空白的結果。');
        }

        const ocrResult = JSON.parse(jsonText.trim());
        
        // Auto fill form fields
        document.getElementById('invDate').value = ocrResult.date || '';
        document.getElementById('invType').value = ocrResult.type || '進項';
        document.getElementById('invNumber').value = ocrResult.invoiceNumber || '';
        document.getElementById('invDetail').value = ocrResult.detail || '';
        document.getElementById('invAmount').value = ocrResult.amount || 0;

        statusText.innerText = '辨識成功！';
        setTimeout(() => loader.classList.add('hidden'), 500);

    } catch (err) {
        console.error('OCR Error', err);
        statusText.innerText = '辨識失敗';
        alert(`AI 智慧辨識發生錯誤：${err.message}\n請檢查 API 金鑰設定，或改用手動填寫。`);
        loader.classList.add('hidden');
    }
}

// ==========================================================================
// Settings Modal Presentation
// ==========================================================================
function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    document.getElementById('apiKeyInput').value = state.settings.apiKey || '';
    document.getElementById('apiModelSelect').value = state.settings.model || 'gemini-3.5-flash';
    
    // 連動後端金鑰狀態提示
    const serverKeyStatus = document.getElementById('serverKeyStatus');
    if (serverKeyStatus) {
        if (state.serverHasKey) {
            serverKeyStatus.style.display = 'block';
        } else {
            serverKeyStatus.style.display = 'none';
        }
    }

    modal.classList.add('active');
    
    // Toggle Visibility Reset
    document.getElementById('apiKeyInput').type = 'password';
    
    const eyeBtn = document.getElementById('toggleApiKeyVisibility');
    eyeBtn.innerHTML = '<i data-lucide="eye"></i>';
    lucide.createIcons();

    // Toggle Eye Click event once
    eyeBtn.onclick = function() {
        const input = document.getElementById('apiKeyInput');
        if (input.type === 'password') {
            input.type = 'text';
            eyeBtn.innerHTML = '<i data-lucide="eye-off"></i>';
        } else {
            input.type = 'password';
            eyeBtn.innerHTML = '<i data-lucide="eye"></i>';
        }
        lucide.createIcons();
    };
}

function closeSettingsModal() {
    document.getElementById('settingsModal').classList.remove('active');
}

function saveSettingsFromForm() {
    const key = document.getElementById('apiKeyInput').value;
    const model = document.getElementById('apiModelSelect').value;
    saveSettings(key, model);
    closeSettingsModal();
    alert('API 金鑰已更新！');
}

// ==========================================================================
// Travel Expense Report Generation & Printing
// ==========================================================================
function updateTravelReportPreview(autoFillFromInvoices = false) {
    const repYear = document.getElementById('repYear').value;
    const repMonth = document.getElementById('repMonth').value;
    const repDateRangeStart = document.getElementById('repDateRangeStart').value;
    const repDateRangeEnd = document.getElementById('repDateRangeEnd').value;
    const repPurpose = document.getElementById('repPurpose').value;
    const repEmployee = document.getElementById('repEmployee').value;
    const repLocation = document.getElementById('repLocation').value || '台北';
    
    const repMealDays = parseInt(document.getElementById('repMealDays').value || 0, 10);
    const repMealRate = parseInt(document.getElementById('repMealRate').value || 0, 10);
    const repStayDays = parseInt(document.getElementById('repStayDays').value || 0, 10);
    const repStayRate = parseInt(document.getElementById('repStayRate').value || 0, 10);
    const repMemo = document.getElementById('repMemo').value;

    // A. 更新填表日期（優先使用手選填表日期，若未選則用今天）
    const repReportDate = document.getElementById('repReportDate')?.value;
    if (repReportDate) {
        const d = new Date(repReportDate);
        document.getElementById('lblYear').innerText = d.getFullYear() - 1911;
        document.getElementById('lblMonth').innerText = d.getMonth() + 1;
        document.getElementById('lblDay').innerText = d.getDate();
    } else {
        const today = new Date();
        document.getElementById('lblYear').innerText = today.getFullYear() - 1911;
        document.getElementById('lblMonth').innerText = today.getMonth() + 1;
        document.getElementById('lblDay').innerText = today.getDate();
    }

    // B. Update Info Fields
    document.getElementById('lblPurpose').innerText = repPurpose || '';
    document.getElementById('lblEmployeeSign').innerText = repEmployee || '';

    // C. Update Start & End Date in Grid
    if (repDateRangeStart) {
        const start = new Date(repDateRangeStart);
        document.getElementById('lblStartYear').innerText = start.getFullYear() - 1911;
        document.getElementById('lblStartMonth').innerText = start.getMonth() + 1;
        document.getElementById('lblStartDay').innerText = start.getDate();
    } else {
        document.getElementById('lblStartYear').innerText = '';
        document.getElementById('lblStartMonth').innerText = '';
        document.getElementById('lblStartDay').innerText = '';
    }

    if (repDateRangeEnd) {
        const end = new Date(repDateRangeEnd);
        document.getElementById('lblEndYear').innerText = end.getFullYear() - 1911;
        document.getElementById('lblEndMonth').innerText = end.getMonth() + 1;
        document.getElementById('lblEndDay').innerText = end.getDate();
    } else {
        document.getElementById('lblEndYear').innerText = '';
        document.getElementById('lblEndMonth').innerText = '';
        document.getElementById('lblEndDay').innerText = '';
    }

    // D. Fetch Filtered Invoices in this Date Range for Travel Expenses
    const startRange = repDateRangeStart ? new Date(repDateRangeStart) : null;
    const endRange = repDateRangeEnd ? new Date(repDateRangeEnd) : null;
    
    // Reset times to compare dates properly
    if (startRange) startRange.setHours(0,0,0,0);
    if (endRange) endRange.setHours(23,59,59,999);

    const reportInvoices = state.invoices.filter(item => {
        const itemDate = new Date(item.date);
        itemDate.setHours(0,0,0,0);
        
        let match = true;
        if (startRange && itemDate < startRange) match = false;
        if (endRange && itemDate > endRange) match = false;
        return match;
    }).sort((a, b) => new Date(a.date) - new Date(b.date));

    // Calculate Grid Categories from Invoices
    let calculatedTrainCost = 0;
    let calculatedCarCost = 0;
    let calculatedOtherCost = 0;
    let miscCost = 0;

    const itineraryRows = [];

    reportInvoices.forEach(item => {
        if (item.type === '交通費') {
            const amount = item.amount || 0;
            if (item.transport === '火車') {
                calculatedTrainCost += amount;
            } else if (item.transport === '汽車') {
                calculatedCarCost += amount;
            } else {
                calculatedOtherCost += amount; // 高鐵/其他
            }

            // Build Travel Itinerary Detail Row
            const cleanDate = item.date.slice(5).replace('-', '/'); // "06/25" format
            itineraryRows.push({
                dateStr: cleanDate,
                location: item.location || repLocation,
                desc: `${item.detail} ($${amount.toLocaleString()})`
            });
        } else if (item.type === '其他') {
            miscCost += item.amount || 0;
        }
    });

    // If auto-fill is requested, populate input boxes with calculated values
    if (autoFillFromInvoices) {
        document.getElementById('repTrainCostInput').value = calculatedTrainCost || '';
        document.getElementById('repCarCostInput').value = calculatedCarCost || '';
        document.getElementById('repOtherCostInput').value = calculatedOtherCost || '';
    }

    // Read final cost values from manual input fields (allows manual overwrite)
    const trainCost = parseInt(document.getElementById('repTrainCostInput').value || 0, 10);
    const carCost = parseInt(document.getElementById('repCarCostInput').value || 0, 10);
    const otherTransportCost = parseInt(document.getElementById('repOtherCostInput').value || 0, 10);

    // Set route location value
    document.getElementById('lblRouteLocation').innerText = repLocation;

    // Populate Transport Costs
    document.getElementById('lblTrainCost').innerText = trainCost > 0 ? trainCost.toLocaleString() : '';
    document.getElementById('lblCarCost').innerText = carCost > 0 ? carCost.toLocaleString() : '';
    document.getElementById('lblOtherTransportCost').innerText = otherTransportCost > 0 ? otherTransportCost.toLocaleString() : '';

    // E. Populate Meal & Stay Costs based on parameters
    const mealCost = repMealDays * repMealRate;
    document.getElementById('lblMealDays').innerText = repMealDays > 0 ? '1' : '';
    document.getElementById('lblMealDaysCount').innerText = repMealDays > 0 ? repMealDays : '';
    document.getElementById('lblMealCost').innerText = mealCost > 0 ? mealCost.toLocaleString() : '';

    // Stay Cost
    const stayCost = repStayDays * repStayRate;
    document.getElementById('lblStayDays').innerText = repStayDays > 0 ? '1' : '';
    document.getElementById('lblStayDaysCount').innerText = repStayDays > 0 ? repStayDays : '';
    document.getElementById('lblStayCost').innerText = stayCost > 0 ? stayCost.toLocaleString() : '';

    // F. Populate Miscellaneous Cost (什費)
    document.getElementById('lblMiscCost').innerText = miscCost > 0 ? miscCost.toLocaleString() : '';

    // G. Calculate Total Cost sum
    const grandTotal = trainCost + carCost + otherTransportCost + mealCost + stayCost + miscCost;
    document.getElementById('lblTotalCost').innerText = grandTotal > 0 ? `$${grandTotal.toLocaleString()}` : '$0';

    // H. Update Memo
    document.getElementById('lblMemo').innerText = repMemo || '';

    // 每次預覽內容更新後，重新計算縮放比例讓圖表正確填滿容器
    requestAnimationFrame(() => {
        if (typeof window._scaleReportPreview === 'function') {
            window._scaleReportPreview();
        }
    });
}

// ==========================================================================
// Helper Utility Functions
// ==========================================================================
function getInvoicesForCurrentMonth() {
    if (!state.currentMonth) return state.invoices;
    return state.invoices.filter(item => item.date.startsWith(state.currentMonth));
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function exportToCsv() {
    const filtered = getInvoicesForCurrentMonth();
    if (filtered.length === 0) {
        alert('當月沒有發票資料可供匯出。');
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; // Include BOM for Chinese Excel rendering
    csvContent += "日期,類型,發票號碼,品名事由,交通工具,地點,金額\n";

    filtered.forEach(item => {
        const trans = item.transport || "";
        const loc = item.location || "";
        const row = [
            item.date,
            item.type,
            item.invoiceNumber || "",
            `"${item.detail.replace(/"/g, '""')}"`,
            trans,
            loc,
            item.amount
        ].join(",");
        csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `發票明細統計_${state.currentMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==========================================================================
// Mock Data Generator for rich visual presentation (Design Aesthetics)
// ==========================================================================
function getMockInvoices() {
    const today = new Date();
    const curYr = today.getFullYear();
    const curMo = String(today.getMonth() + 1).padStart(2, '0');
    
    return [
        {
            id: 'mock1',
            date: `${curYr}-${curMo}-05`,
            type: '交通費',
            invoiceNumber: '',
            detail: '台北到左營高鐵票',
            amount: 1490,
            transport: '其他',
            location: '左營'
        },
        {
            id: 'mock2',
            date: `${curYr}-${curMo}-05`,
            type: '進項',
            invoiceNumber: 'GX-98765432',
            detail: '客戶晚餐餐會',
            amount: 2350
        },
        {
            id: 'mock3',
            date: `${curYr}-${curMo}-06`,
            type: '交通費',
            invoiceNumber: '',
            detail: '左營到台南台鐵自強號',
            amount: 106,
            transport: '火車',
            location: '台南'
        },
        {
            id: 'mock4',
            date: `${curYr}-${curMo}-08`,
            type: '住宿費',
            invoiceNumber: 'HZ-12345678',
            detail: '台南商務旅館住宿',
            amount: 3200
        },
        {
            id: 'mock5',
            date: `${curYr}-${curMo}-09`,
            type: '交通費',
            invoiceNumber: '',
            detail: '台南到台北高鐵票',
            amount: 1350,
            transport: '其他',
            location: '台北'
        },
        {
            id: 'mock6',
            date: `${curYr}-${curMo}-09`,
            type: '交通費',
            invoiceNumber: '',
            detail: '台北車站至公司計程車車資',
            amount: 220,
            transport: '汽車',
            location: '台北'
        },
        {
            id: 'mock7',
            date: `${curYr}-${curMo}-12`,
            type: '銷項',
            invoiceNumber: 'AA-88889999',
            detail: '專案顧問服務費用',
            amount: 45000
        }
    ];
}

// ==========================================================================
// 出差報告表存檔與合併列印邏輯
// ==========================================================================

function loadReports() {
    const saved = localStorage.getItem('invoice_helper_reports');
    if (saved) {
        try {
            state.reports = JSON.parse(saved);
        } catch (e) {
            console.error('Failed to parse reports', e);
            state.reports = [];
        }
    } else {
        state.reports = [];
    }
}

function saveReportsToStorage() {
    localStorage.setItem('invoice_helper_reports', JSON.stringify(state.reports));
}

function renderReportsTable() {
    const tbody = document.getElementById('savedReportsTableBody');
    const emptyState = document.getElementById('reportsEmptyState');
    if (!tbody || !emptyState) return;

    tbody.innerHTML = '';
    
    if (state.reports.length === 0) {
        emptyState.classList.remove('hidden');
        document.getElementById('chkSelectAllReports').checked = false;
        return;
    }

    emptyState.classList.add('hidden');

    state.reports.forEach(report => {
        const tr = document.createElement('tr');
        
        const dateRangeText = (report.dateRangeStart && report.dateRangeEnd) 
            ? `${report.dateRangeStart} ~ ${report.dateRangeEnd}` 
            : `${report.year}年${report.month}月`;
            
        tr.innerHTML = `
            <td style="text-align: center;">
                <input type="checkbox" class="report-checkbox" data-id="${report.id}">
            </td>
            <td>${dateRangeText}</td>
            <td>${escapeHtml(report.purpose || '-')}</td>
            <td>${escapeHtml(report.location || '-')}</td>
            <td>${escapeHtml(report.employee || '-')}</td>
            <td class="text-right font-bold">$${(report.totalCost || 0).toLocaleString()}</td>
            <td class="text-center">
                <div class="action-buttons">
                    <button class="btn-table-edit" onclick="loadReportDirect('${report.id}')" title="載入預覽/編輯">
                        <i data-lucide="eye" style="width: 14px; height: 14px;"></i>
                    </button>
                    <button class="btn-table-delete" onclick="deleteReportDirect('${report.id}')" title="刪除">
                        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // 綁定單個 checkbox 點擊事件，更新全選 checkbox 狀態
    const checkboxes = tbody.querySelectorAll('.report-checkbox');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            const allChecked = Array.from(checkboxes).every(c => c.checked);
            document.getElementById('chkSelectAllReports').checked = allChecked;
        });
    });

    lucide.createIcons();
}

window.loadReportDirect = function(id) {
    const report = state.reports.find(r => r.id === id);
    if (!report) return;
    
    // 填回表單
    document.getElementById('repYear').value = report.year || '';
    document.getElementById('repMonth').value = report.month || '';
    document.getElementById('repDateRangeStart').value = report.dateRangeStart || '';
    document.getElementById('repDateRangeEnd').value = report.dateRangeEnd || '';
    document.getElementById('repPurpose').value = report.purpose || '';
    document.getElementById('repEmployee').value = report.employee || '';
    document.getElementById('repLocation').value = report.location || '';
    
    document.getElementById('repTrainCostInput').value = report.trainCost || 0;
    document.getElementById('repCarCostInput').value = report.carCost || 0;
    document.getElementById('repOtherCostInput').value = report.otherCost || 0;
    
    document.getElementById('repMealDays').value = report.mealDays || 0;
    document.getElementById('repMealRate').value = report.mealRate || 0;
    document.getElementById('repStayDays').value = report.stayDays || 0;
    document.getElementById('repStayRate').value = report.stayRate || 0;
    
    document.getElementById('repMemo').value = report.memo || '';
    
    // 更新預覽 (傳入 false 避免覆蓋輸入框)
    updateTravelReportPreview(false);
    
    alert('已載入報告表設定並更新右側預覽！');
};

window.deleteReportDirect = function(id) {
    if (confirm('確定要刪除此筆已儲存的出差旅費報告表嗎？')) {
        state.reports = state.reports.filter(r => r.id !== id);
        saveReportsToStorage();
        renderReportsTable();
    }
};

function handleSaveReport() {
    const repYear = document.getElementById('repYear').value;
    const repMonth = document.getElementById('repMonth').value;
    const repDateRangeStart = document.getElementById('repDateRangeStart').value;
    const repDateRangeEnd = document.getElementById('repDateRangeEnd').value;
    const repPurpose = document.getElementById('repPurpose').value;
    const repEmployee = document.getElementById('repEmployee').value;
    const repLocation = document.getElementById('repLocation').value || '台北';
    
    const trainCost = parseInt(document.getElementById('repTrainCostInput').value || 0, 10);
    const carCost = parseInt(document.getElementById('repCarCostInput').value || 0, 10);
    const otherCost = parseInt(document.getElementById('repOtherCostInput').value || 0, 10);
    
    const repMealDays = parseInt(document.getElementById('repMealDays').value || 0, 10);
    const repMealRate = parseInt(document.getElementById('repMealRate').value || 0, 10);
    const repStayDays = parseInt(document.getElementById('repStayDays').value || 0, 10);
    const repStayRate = parseInt(document.getElementById('repStayRate').value || 0, 10);
    const repMemo = document.getElementById('repMemo').value;

    const mealCost = repMealDays * repMealRate;
    const stayCost = repStayDays * repStayRate;
    
    // 計算合計 (什費在預覽中是從 Invoices 的 "其他" 計算，但因為是儲存，我們也需要從 Invoices 算一下什費以便計入 total)
    // 或是直接讀取 UI 上的金額，這最準確！
    const miscCostText = document.getElementById('lblMiscCost').innerText || '0';
    const miscCost = parseInt(miscCostText.replace(/,/g, ''), 10) || 0;
    
    const grandTotal = trainCost + carCost + otherCost + mealCost + stayCost + miscCost;
    
    if (!repEmployee) {
        alert('請輸入出差人姓名！');
        return;
    }

    const report = {
        id: Date.now().toString() + Math.floor(Math.random() * 1000),
        year: repYear,
        month: repMonth,
        dateRangeStart: repDateRangeStart,
        dateRangeEnd: repDateRangeEnd,
        purpose: repPurpose,
        employee: repEmployee,
        location: repLocation,
        trainCost: trainCost,
        carCost: carCost,
        otherCost: otherCost,
        mealDays: repMealDays,
        mealRate: repMealRate,
        stayDays: repStayDays,
        stayRate: repStayRate,
        miscCost: miscCost,
        totalCost: grandTotal,
        memo: repMemo,
        dateCreated: new Date().toISOString()
    };

    state.reports.push(report);
    saveReportsToStorage();
    renderReportsTable();
    alert('出差旅費報告表已成功儲存至歷史存檔！');
}

function handleBatchPrintReports() {
    const tbody = document.getElementById('savedReportsTableBody');
    if (!tbody) return;
    
    const checkboxes = tbody.querySelectorAll('.report-checkbox:checked');
    if (checkboxes.length === 0) {
        alert('請至少勾選一張報告表以進行合併列印！');
        return;
    }

    const selectedIds = Array.from(checkboxes).map(cb => cb.getAttribute('data-id'));
    const selectedReports = state.reports.filter(r => selectedIds.includes(r.id));
    
    // 依日期排序
    selectedReports.sort((a, b) => new Date(a.dateRangeStart) - new Date(b.dateRangeStart));

    const printContainer = document.getElementById('batchPrintContainer');
    printContainer.innerHTML = '';

    selectedReports.forEach(report => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'batch-report-item';
        
        const paperDiv = document.createElement('div');
        paperDiv.className = 'paper-page';
        paperDiv.innerHTML = generateReportHtml(report);
        
        itemDiv.appendChild(paperDiv);
        printContainer.appendChild(itemDiv);
    });

    // 動態設定直向合併列印樣式
    let printStyle = document.getElementById('print-layout-style');
    if (!printStyle) {
        printStyle = document.createElement('style');
        printStyle.id = 'print-layout-style';
        document.head.appendChild(printStyle);
    }
    printStyle.innerHTML = '@page { size: portrait; margin: 5mm; }';

    // 加上列印標誌 Class
    document.body.classList.add('batch-printing');
    
    // 觸發列印
    window.print();
}

// 監聽列印完成，還原狀態
window.addEventListener('afterprint', () => {
    document.body.classList.remove('batch-printing');
    const printContainer = document.getElementById('batchPrintContainer');
    if (printContainer) printContainer.innerHTML = '';
    
    // 移除動態列印樣式，還原為瀏覽器預設
    const printStyle = document.getElementById('print-layout-style');
    if (printStyle) {
        printStyle.remove();
    }
});

function generateReportHtml(report) {
    const today = new Date(report.dateCreated || Date.now());
    const printYear = today.getFullYear() - 1911;
    const printMonth = today.getMonth() + 1;
    const printDay = today.getDate();
    
    // 計算日期的民國格式
    let startYear = '', startMonth = '', startDay = '';
    if (report.dateRangeStart) {
        const start = new Date(report.dateRangeStart);
        startYear = start.getFullYear() - 1911;
        startMonth = start.getMonth() + 1;
        startDay = start.getDate();
    }
    
    let endYear = '', endMonth = '', endDay = '';
    if (report.dateRangeEnd) {
        const end = new Date(report.dateRangeEnd);
        endYear = end.getFullYear() - 1911;
        endMonth = end.getMonth() + 1;
        endDay = end.getDate();
    }
    
    const mealText = report.mealDays > 0 ? `1人 ${report.mealDays}天` : '';
    const mealCostVal = report.mealDays * report.mealRate;
    const mealCostText = mealCostVal > 0 ? mealCostVal.toLocaleString() : '';
    
    const stayText = report.stayDays > 0 ? `1人 ${report.stayDays}天` : '';
    const stayCostVal = report.stayDays * report.stayRate;
    const stayCostText = stayCostVal > 0 ? stayCostVal.toLocaleString() : '';
    
    const trainText = report.trainCost > 0 ? report.trainCost.toLocaleString() : '';
    const carText = report.carCost > 0 ? report.carCost.toLocaleString() : '';
    const otherText = report.otherCost > 0 ? report.otherCost.toLocaleString() : '';
    const miscText = report.miscCost > 0 ? report.miscCost.toLocaleString() : '';
    const totalText = report.totalCost > 0 ? `$${report.totalCost.toLocaleString()}` : '$0';
    
    return `
        <div class="report-title-section">
            <div class="double-underline-container">
                <h1 class="report-main-title">出差旅費報告表</h1>
            </div>
            <div class="report-date-row">
                民國 <span class="fill-line user-fill" style="width: 40px;">${printYear}</span> 年 
                <span class="fill-line user-fill" style="width: 30px;">${printMonth}</span> 月 
                <span class="fill-line user-fill" style="width: 30px;">${printDay}</span> 日
            </div>
        </div>
        <table class="report-grid-table">
            <tbody>
                <tr>
                    <td class="col-purpose-label text-center font-bold" style="width: 6%;">事<br>由</td>
                    <td class="col-purpose-val user-fill" style="width: 44%; vertical-align: top; padding: 8px;">${escapeHtml(report.purpose || '')}</td>
                    <td class="col-summary-label text-center font-bold" colspan="2" style="width: 30%;">摘&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;要</td>
                    <td class="col-amount-label text-center font-bold" style="width: 20%;">金&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;額</td>
                </tr>
                <tr>
                    <td class="col-route-label text-center font-bold" rowspan="3">旅<br>程</td>
                    <td class="col-route-val user-fill" rowspan="3" style="vertical-align: middle; padding: 12px; font-size: 24px; font-weight: bold; letter-spacing: 2px;">
                        ${escapeHtml(report.location || '')}
                    </td>
                    <td class="sub-summary-label text-center" rowspan="3" style="width: 8%;">車<br><br>費</td>
                    <td class="item-label" style="width: 22%;">火車車費</td>
                    <td class="item-amount text-right user-fill">${trainText}</td>
                </tr>
                <tr>
                    <td class="item-label">汽車車費</td>
                    <td class="item-amount text-right user-fill">${carText}</td>
                </tr>
                <tr>
                    <td class="item-label">其&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;他</td>
                    <td class="item-amount text-right user-fill">${otherText}</td>
                </tr>
                <tr>
                    <td class="col-date-label text-center font-bold">日<br>期</td>
                    <td class="col-date-val" style="padding: 8px;">
                        自民國 <span class="user-fill">${startYear}</span> 年 <span class="user-fill">${startMonth}</span> 月 <span class="user-fill">${startDay}</span> 日 起<br>
                        至民國 <span class="user-fill">${endYear}</span> 年 <span class="user-fill">${endMonth}</span> 月 <span class="user-fill">${endDay}</span> 日 止
                    </td>
                    <td class="item-label text-center font-bold" colspan="2">
                        膳費 (${mealText})
                    </td>
                    <td class="item-amount text-right user-fill">${mealCostText}</td>
                </tr>
                <tr>
                    <td class="col-memo-label text-center font-bold" rowspan="3">附<br><br>記</td>
                    <td class="col-memo-val user-fill" rowspan="3" style="vertical-align: top; padding: 8px; font-size: 11px; line-height: 1.5;">${escapeHtml(report.memo || '')}</td>
                    <td class="item-label text-center font-bold" colspan="2">
                        宿費 (${stayText})
                    </td>
                    <td class="item-amount text-right user-fill">${stayCostText}</td>
                </tr>
                <tr>
                    <td class="item-label text-center font-bold" colspan="2" style="height: 28px;">什費</td>
                    <td class="item-amount text-right user-fill">${miscText}</td>
                </tr>
                <tr>
                    <td class="item-label text-center font-bold" colspan="2" style="height: 28px;"></td>
                    <td class="item-amount text-right"></td>
                </tr>
                <tr>
                    <td class="col-total-label text-center font-bold" colspan="2" style="height: 32px;">合&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;計</td>
                    <td class="col-total-label text-center font-bold" colspan="2"></td>
                    <td class="item-amount text-right font-bold user-fill" style="font-size: 14px;">${totalText}</td>
                </tr>
            </tbody>
        </table>
        <div class="sign-off-area">
            <div class="sign-column"><span class="sign-title">核准</span><span class="sign-value"></span></div>
            <div class="sign-column"><span class="sign-title">會計</span><span class="sign-value"></span></div>
            <div class="sign-column"><span class="sign-title">覆核</span><span class="sign-value"></span></div>
            <div class="sign-column"><span class="sign-title">出納</span><span class="sign-value"></span></div>
            <div class="sign-column"><span class="sign-title">登帳</span><span class="sign-value"></span></div>
            <div class="sign-column"><span class="sign-title">出差人</span><span class="sign-value user-fill">${escapeHtml(report.employee || '')}</span></div>
        </div>
    `;
}

function handleLogout() {
    if (confirm('確定要安全登出嗎？')) {
        fetch('/api/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(res => {
            if (res.ok) {
                window.location.href = '/login';
            } else {
                alert('登出失敗，請重試！');
            }
        })
        .catch(err => {
            console.error('Logout error:', err);
            alert('登出發生錯誤！');
        });
    }
}
