// API Base URL
const API_URL = window.location.origin;
let authToken = localStorage.getItem('admin_token');
let currentUserId = null;
let allTransactions = [];

// ==================== MOBILE SIDEBAR FUNCTIONS ====================

function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const hamburger = document.getElementById('hamburgerMenu');
    
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
    hamburger.classList.toggle('active');
}

function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const hamburger = document.getElementById('hamburgerMenu');
    
    sidebar.classList.remove('active');
    overlay.classList.remove('active');
    hamburger.classList.remove('active');
}

// Check authentication on load
window.addEventListener('DOMContentLoaded', function() {
    if (authToken) {
        showDashboard();
        loadDashboardData();
    } else {
        document.getElementById('loginScreen').style.display = 'flex';
    }
});

// Login Form Handler
document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const email = document.getElementById('adminEmail').value;
    const password = document.getElementById('adminPassword').value;
    
    try {
        const response = await fetch(`${API_URL}/api/auth/admin-login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        if (response.ok) {
            const data = await response.json();
            authToken = data.access_token;
            localStorage.setItem('admin_token', authToken);
            
            // Verify admin status
            const userResponse = await fetch(`${API_URL}/api/auth/me`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });
            
            const userData = await userResponse.json();
            
            if (userData.is_admin) {
                document.getElementById('adminName').textContent = userData.full_name;
                showDashboard();
                loadDashboardData();
            } else {
                showError('Access denied. Admin privileges required.');
                logout();
            }
        } else {
            const errorData = await response.json();
            showError(errorData.detail || 'Login failed. Please check your credentials.');
        }
    } catch (error) {
        showError('Login failed. Please check your connection.');
        console.error('Login error:', error);
    }
});

function showError(message) {
    const errorDiv = document.getElementById('loginError');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';
}

function logout() {
    localStorage.removeItem('admin_token');
    authToken = null;
    location.reload();
}

// Show a specific section (used by clickable dashboard cards)
function showSection(sectionName) {
    // Map section names to page names
    const sectionMap = {
        'users': 'users',
        'investments': 'investments',
        'transactions': 'transactions',
        'withdrawals': 'withdrawals'
    };
    
    const page = sectionMap[sectionName];
    if (!page) return;
    
    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.classList.remove('active');
        if (nav.getAttribute('data-page') === page) {
            nav.classList.add('active');
        }
    });
    
    // Hide all pages and show the selected one
    document.querySelectorAll('.page-content').forEach(p => p.style.display = 'none');
    
    const pageElement = document.getElementById(page + 'Page');
    if (pageElement) {
        pageElement.style.display = 'block';
        
        const titles = {
            'overview': 'Dashboard Overview',
            'users': 'User Management',
            'wallets': 'Wallet Management',
            'p2p': 'P2P Wallet Transfer',
            'withdrawals': 'Withdrawal Requests',
            'investments': 'Investments',
            'transactions': 'Transactions',
            'income': 'Income Calculator',
            'learning': 'Learning Center',
            'tickets': 'Support Tickets'
        };
        document.getElementById('pageTitle').textContent = titles[page] || page;
        
        loadPageData(page);
    }
}

// Navigation
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function(e) {
        if (this.getAttribute('onclick')) return;
        
        e.preventDefault();
        const page = this.getAttribute('data-page');
        
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        this.classList.add('active');
        
        document.querySelectorAll('.page-content').forEach(p => p.style.display = 'none');
        
        const pageElement = document.getElementById(page + 'Page');
        if (pageElement) {
            pageElement.style.display = 'block';
            
            const titles = {
                'overview': 'Dashboard Overview',
                'users': 'User Management',
                'wallets': 'Wallet Management',
                'p2p': 'P2P Wallet Transfer',
                'withdrawals': 'Withdrawal Requests',
                'investments': 'Investments',
                'transactions': 'Transactions',
                'income': 'Income Calculator',
                'learning': 'Learning Center',
                'tickets': 'Support Tickets'
            };
            document.getElementById('pageTitle').textContent = titles[page];
            
            loadPageData(page);
        }
        
        // Close mobile sidebar after navigation
        closeMobileSidebar();
    });
});

function loadPageData(page) {
    switch(page) {
        case 'overview':
            loadDashboardData();
            break;
        case 'users':
            loadUsers();
            break;
        case 'wallets':
            loadWallets();
            break;
        case 'p2p':
            loadP2PTransfers();
            break;
        case 'withdrawals':
            loadWithdrawals();
            break;
        case 'investments':
            loadInvestments();
            break;
        case 'transactions':
            loadTransactions();
            break;
        case 'income':
            loadUsersForSalary();
            break;
        case 'plans':
            loadInvestmentPlans();
            break;
        case 'learning':
            loadLearningVideos();
            break;
        case 'tickets':
            loadAdminTickets();
            break;
    }
}

// Dashboard Data
async function loadDashboardData() {
    try {
        const response = await fetch(`${API_URL}/api/admin/dashboard/stats`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            document.getElementById('totalUsers').textContent = data.total_users;
            document.getElementById('totalInvestment').textContent = `$${(data.total_platform_investment || 0).toFixed(2)}`;
            document.getElementById('totalEarnings').textContent = `$${(data.total_earnings_distributed || 0).toFixed(2)}`;
            
            // Income summary
            if (data.income_summary) {
                document.getElementById('totalDailyRoi').textContent = `$${(data.income_summary.daily_roi || 0).toFixed(2)}`;
                document.getElementById('totalDirectIncome').textContent = `$${(data.income_summary.direct_income || 0).toFixed(2)}`;
                document.getElementById('totalSlabIncome').textContent = `$${(data.income_summary.slab_income || 0).toFixed(2)}`;
                document.getElementById('totalRoyaltyIncome').textContent = `$${(data.income_summary.royalty_income || 0).toFixed(2)}`;
                document.getElementById('totalSalaryIncome').textContent = `$${(data.income_summary.salary_income || 0).toFixed(2)}`;
            }
        }
        
        // Load withdrawals for total
        const wResponse = await fetch(`${API_URL}/api/admin/withdrawals`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (wResponse.ok) {
            const wData = await wResponse.json();
            document.getElementById('totalWithdrawals').textContent = `$${(wData.summary?.total_withdrawn || 0).toFixed(2)}`;
        }
    } catch (error) {
        console.error('Error loading dashboard data:', error);
    }
}

function refreshDashboard() {
    loadDashboardData();
    alert('Dashboard data refreshed!');
}

// ==================== USERS MANAGEMENT ====================

// Store all users for filtering
let allUsersData = [];

function filterNonAdminUsers(users) {
    return (users || []).filter(user => !user.is_admin);
}

function escapeTreeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sortUsersForTree(a, b) {
    const aCode = (a.referral_code || '').toString();
    const bCode = (b.referral_code || '').toString();
    const aName = (a.full_name || a.email || '').toString();
    const bName = (b.full_name || b.email || '').toString();

    return aCode.localeCompare(bCode, undefined, { numeric: true, sensitivity: 'base' }) ||
        aName.localeCompare(bName, undefined, { sensitivity: 'base' });
}

function buildUsersTreeNode(node, level = 0) {
    const children = Array.isArray(node.children) ? node.children : [];
    const memberId = node.id || node.user_id || '';
    const teamSize = children.length;
    const fullNameRaw = (node.full_name || 'User').trim();
    const fullName = escapeTreeHtml(fullNameRaw || 'User');
    const firstInitial = escapeTreeHtml(fullNameRaw ? fullNameRaw.charAt(0).toUpperCase() : 'U');
    const referralCode = escapeTreeHtml((node.referral_code || 'N/A').toString());
    const childrenMarkup = children.map(child => buildUsersTreeNode(child, level + 1)).join('');
    const toggleMarkup = teamSize > 0
        ? '<button class="tree-toggle" type="button" onclick="toggleUsersTreeNode(this)" aria-label="Toggle referral tree">+</button>'
        : '';

    return `
        <div class="tree-node" data-level="${level}" data-user-id="${escapeTreeHtml(String(memberId))}">
            <div class="tree-node-content ${teamSize > 0 ? 'has-children' : ''}">
                <div class="tree-node-avatar">${firstInitial}</div>
                <div class="tree-node-info">
                    <h4>${fullName}</h4>
                    <span>${referralCode}</span>
                </div>
            </div>
            ${toggleMarkup}
            <div class="tree-children" data-user-id="${escapeTreeHtml(String(memberId))}" data-level="${level + 1}">
                ${childrenMarkup}
            </div>
        </div>
    `;
}

function toggleUsersTreeNode(element) {
    const treeNode = element.closest('.tree-node');
    if (!treeNode) return;

    const childrenContainer = Array.from(treeNode.children).find(child =>
        child.classList && child.classList.contains('tree-children')
    );
    if (!childrenContainer || childrenContainer.children.length === 0) return;

    const nodeContent = treeNode.querySelector('.tree-node-content');

    if (childrenContainer.classList.contains('show')) {
        childrenContainer.classList.remove('show');
        if (nodeContent) nodeContent.classList.remove('expanded');
        element.textContent = '+';
    } else {
        childrenContainer.classList.add('show');
        if (nodeContent) nodeContent.classList.add('expanded');
        element.textContent = '−';
    }
}

function renderUsersTreeView(users) {
    const treeContainer = document.getElementById('usersTreeContainer');
    const treeStats = document.getElementById('usersTreeStats');

    if (!treeContainer || !treeStats) {
        return;
    }

    treeContainer.classList.add('tree-layout');

    if (!users || users.length === 0) {
        treeStats.textContent = '0 users shown • 0 root nodes';
        treeContainer.innerHTML = '<p class="empty-state">No team members yet. Share your referral link!</p>';
        return;
    }

    const userMap = new Map();
    users.forEach(user => {
        userMap.set(user.id, { ...user, children: [] });
    });

    const roots = [];
    userMap.forEach(node => {
        const parentId = node.referred_by;
        if (parentId && userMap.has(parentId)) {
            userMap.get(parentId).children.push(node);
        } else {
            roots.push(node);
        }
    });

    const sortTree = (nodes) => {
        nodes.sort(sortUsersForTree);
        nodes.forEach(item => sortTree(item.children));
    };
    sortTree(roots);

    treeStats.textContent = `${users.length} users shown • ${roots.length} root nodes`;
    treeContainer.innerHTML = roots.map(root => buildUsersTreeNode(root)).join('');
}

function getFilteredUsersForDisplay() {
    let users = filterUsersByDate(allUsersData);
    const searchTerm = (document.getElementById('userSearch')?.value || '').trim().toLowerCase();

    if (!searchTerm) {
        return users;
    }

    return users.filter(user => {
        const referralCode = (user.referral_code || '').toString().toLowerCase();
        const fullName = (user.full_name || '').toLowerCase();
        const email = (user.email || '').toLowerCase();
        const status = (user.status || '').toLowerCase();

        return referralCode.includes(searchTerm) ||
            fullName.includes(searchTerm) ||
            email.includes(searchTerm) ||
            status.includes(searchTerm);
    });
}

function applyUsersFiltersAndRender() {
    const filteredUsers = getFilteredUsersForDisplay();
    renderUsersTable(filteredUsers);
    renderUsersTreeView(filteredUsers);
}

function refreshUsersTreeView() {
    applyUsersFiltersAndRender();
}

async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="loading">Loading users...</td></tr>';
    
    // Reset selection
    selectedUserIds = [];
    updateUserBulkActions();
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users?limit=1000`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            allUsersData = filterNonAdminUsers(data.users || []);
            applyUsersFiltersAndRender();
        }
    } catch (error) {
        console.error('Error loading users:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="loading">Error loading users</td></tr>';
    }
}

function filterUsersByDate(users) {
    const filter = document.getElementById('userDateFilter').value;
    if (!filter || filter === '') return users;
    
    const now = new Date();
    let startDate = null;
    let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    
    if (filter === 'weekly') {
        // Start of this week (Sunday)
        startDate = new Date(now);
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
    } else if (filter === 'monthly') {
        // Start of this month
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (filter === 'quarterly') {
        // Start of this quarter
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
    } else if (filter === 'yearly') {
        // Start of this year
        startDate = new Date(now.getFullYear(), 0, 1);
    } else if (filter === 'custom') {
        const customStart = document.getElementById('userStartDate').value;
        const customEnd = document.getElementById('userEndDate').value;
        if (customStart) startDate = new Date(customStart);
        if (customEnd) {
            endDate = new Date(customEnd);
            endDate.setHours(23, 59, 59, 999);
        }
    }
    
    if (!startDate) return users;
    
    return users.filter(user => {
        const userDate = new Date(user.created_at);
        return userDate >= startDate && userDate <= endDate;
    });
}

function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading">No users found for selected period</td></tr>';
        return;
    }
    
    tbody.innerHTML = '';
    users.forEach(user => {
        const wallet = user.wallet || {};
        const totalIncome = (wallet.daily_roi || 0) + (wallet.direct_income || 0) + 
                           (wallet.slab_income || 0) + (wallet.royalty_income || 0) + 
                           (wallet.salary_income || 0);
        
        const statusClass = user.status === 'active' ? 'status-active' : 'status-inactive';
        const statusText = user.status === 'active' ? 'Active' : 'Inactive';
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><input type="checkbox" value="${user.id}" onchange="toggleUserSelection('${user.id}')"></td>
            <td><strong>#${user.referral_code || 'N/A'}</strong></td>
            <td>${user.email}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>$${(wallet.total_invested || 0).toFixed(2)}</td>
            <td>$${totalIncome.toFixed(2)}</td>
            <td>${new Date(user.created_at).toLocaleDateString()}</td>
            <td class="action-buttons">
                <button class="btn btn-info btn-sm" onclick="viewUser('${user.id}')">Manage</button>
                ${!user.is_admin ? `
                    <button class="btn ${user.status === 'active' ? 'btn-warning' : 'btn-success'} btn-sm" onclick="toggleUserStatus('${user.id}')">${user.status === 'active' ? 'Deact.' : 'Act.'}</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteUser('${user.id}')">Del</button>
                ` : ''}
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Toggle User Status
async function toggleUserStatus(userId) {
    try {
        const response = await fetch(`${API_URL}/api/admin/users/${userId}/toggle-status`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            alert(data.message);
            loadUsers();
        } else {
            alert('Failed to toggle user status');
        }
    } catch (error) {
        console.error('Error toggling status:', error);
        alert('Failed to toggle user status');
    }
}

// View User Details
async function viewUser(userId) {
    currentUserId = userId;
    try {
        const response = await fetch(`${API_URL}/api/admin/users/${userId}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            const user = data.user;
            const wallet = data.wallet || {};
            
            // Store user for investment modal
            selectedUserForInvestment = user;
            
            document.getElementById('modalUserName').textContent = user.full_name;
            
            // Get referrer info
            let referrerInfo = 'None';
            if (user.referred_by) {
                try {
                    const refResponse = await fetch(`${API_URL}/api/admin/users/${user.referred_by}`, {
                        headers: { 'Authorization': `Bearer ${authToken}` }
                    });
                    if (refResponse.ok) {
                        const refData = await refResponse.json();
                        referrerInfo = `${refData.user.full_name} (#${refData.user.referral_code || 'N/A'})`;
                    }
                } catch (e) {}
            }
            
            const content = `
                <div class="user-details">
                    <div class="detail-row">
                        <span class="detail-label">Referral Code:</span>
                        <span class="detail-value"><strong>#${user.referral_code || 'N/A'}</strong></span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Email:</span>
                        <span class="detail-value">${user.email}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Referral Code:</span>
                        <span class="detail-value"><code>${user.referral_code}</code></span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Referred By:</span>
                        <span class="detail-value">${referrerInfo}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Status:</span>
                        <span class="detail-value"><span class="status-badge ${user.status === 'active' ? 'status-active' : 'status-inactive'}">${user.status || 'active'}</span></span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Total Invested:</span>
                        <span class="detail-value">$${(wallet.total_invested || 0).toFixed(2)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Direct Referrals:</span>
                        <span class="detail-value">${data.referrals?.length || 0}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Joined:</span>
                        <span class="detail-value">${new Date(user.created_at).toLocaleString()}</span>
                    </div>
                </div>
            `;
            
            document.getElementById('modalUserContent').innerHTML = content;
            
            // Pre-fill edit fields
            document.getElementById('editUserEmail').value = user.email;
            document.getElementById('newReferrerCode').value = '';
            document.getElementById('newReferrerInfo').style.display = 'none';
            document.getElementById('editUserMessage').style.display = 'none';
            
            document.getElementById('userModal').style.display = 'flex';
        }
    } catch (error) {
        console.error('Error loading user details:', error);
        alert('Failed to load user details');
    }
}

function closeUserModal() {
    document.getElementById('userModal').style.display = 'none';
    currentUserId = null;
    // Reset to first tab
    showUserTab('details');
}

// ==================== USER MODAL TABS ====================

function showUserTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.modal-tab-content').forEach(tab => {
        tab.style.display = 'none';
    });
    
    // Remove active class from all tabs
    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Show selected tab content and mark button as active
    if (tabName === 'details') {
        document.getElementById('userDetailsTab').style.display = 'block';
        document.querySelector('.modal-tab[onclick="showUserTab(\'details\')"]').classList.add('active');
    } else if (tabName === 'transactions') {
        document.getElementById('userTransactionsTab').style.display = 'block';
        document.querySelector('.modal-tab[onclick="showUserTab(\'transactions\')"]').classList.add('active');
        loadUserTransactions(currentUserId);
    } else if (tabName === 'referrals') {
        document.getElementById('userReferralsTab').style.display = 'block';
        document.querySelector('.modal-tab[onclick="showUserTab(\'referrals\')"]').classList.add('active');
        loadUserReferrals(currentUserId);
    }
}

async function loadUserTransactions(userId) {
    if (!userId) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/${userId}/transactions`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // Render summary
            document.getElementById('transactionSummary').innerHTML = `
                <div class="summary-card">
                    <div class="summary-value">${data.summary.total_transactions}</div>
                    <div class="summary-label">Total Transactions</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value">${data.summary.total_investments}</div>
                    <div class="summary-label">Investments</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value">$${data.summary.total_invested_amount.toFixed(2)}</div>
                    <div class="summary-label">Total Invested</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value">$${data.summary.total_withdrawn_amount.toFixed(2)}</div>
                    <div class="summary-label">Total Withdrawn</div>
                </div>
            `;
            
            // Render investments table
            const invTable = document.getElementById('userInvestmentsTable');
            if (data.investments.length > 0) {
                invTable.innerHTML = data.investments.map(inv => `
                    <tr>
                        <td><strong>$${inv.amount.toFixed(2)}</strong></td>
                        <td>${inv.plan}</td>
                        <td><span class="status-${inv.status}">${inv.status}</span></td>
                        <td>${new Date(inv.start_date).toLocaleDateString()}</td>
                        <td>${inv.end_date ? new Date(inv.end_date).toLocaleDateString() : 'N/A'}</td>
                    </tr>
                `).join('');
            } else {
                invTable.innerHTML = '<tr><td colspan="5" class="empty">No investments found</td></tr>';
            }
            
            // Render transactions table
            const txTable = document.getElementById('userTransactionsTable');
            if (data.transactions.length > 0) {
                txTable.innerHTML = data.transactions.map(tx => `
                    <tr>
                        <td>${tx.type.replace(/_/g, ' ')}</td>
                        <td class="${tx.amount >= 0 ? 'amount-positive' : 'amount-negative'}">
                            ${tx.amount >= 0 ? '+' : ''}$${Math.abs(tx.amount).toFixed(2)}
                        </td>
                        <td>${tx.description || '-'}</td>
                        <td>${new Date(tx.date).toLocaleString()}</td>
                    </tr>
                `).join('');
            } else {
                txTable.innerHTML = '<tr><td colspan="4" class="empty">No transactions found</td></tr>';
            }
            
            // Render withdrawals table
            const wdTable = document.getElementById('userWithdrawalsTable');
            if (data.withdrawals.length > 0) {
                wdTable.innerHTML = data.withdrawals.map(w => `
                    <tr>
                        <td><strong>$${w.amount.toFixed(2)}</strong></td>
                        <td><span class="status-${w.status}">${w.status}</span></td>
                        <td>${new Date(w.request_date).toLocaleDateString()}</td>
                        <td>${w.processed_date ? new Date(w.processed_date).toLocaleDateString() : '-'}</td>
                    </tr>
                `).join('');
            } else {
                wdTable.innerHTML = '<tr><td colspan="4" class="empty">No withdrawals found</td></tr>';
            }
        }
    } catch (error) {
        console.error('Error loading user transactions:', error);
    }
}

async function loadUserReferrals(userId) {
    if (!userId) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/${userId}/referrals`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // Render summary
            document.getElementById('referralSummary').innerHTML = `
                <div class="summary-card">
                    <div class="summary-value">${data.summary.total_direct_referrals}</div>
                    <div class="summary-label">Direct Referrals</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value">${data.summary.active_referrals}</div>
                    <div class="summary-label">Active</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value">${data.summary.inactive_referrals}</div>
                    <div class="summary-label">Inactive</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value">$${data.summary.total_team_investment.toFixed(2)}</div>
                    <div class="summary-label">Team Investment</div>
                </div>
            `;
            
            // Show referred by section if applicable
            const referredBySection = document.getElementById('referredBySection');
            if (data.referred_by) {
                referredBySection.style.display = 'block';
                document.getElementById('referredByInfo').innerHTML = `
                    <div class="avatar">${data.referred_by.full_name.charAt(0).toUpperCase()}</div>
                    <div class="info">
                        <div class="name">${data.referred_by.full_name}</div>
                        <div class="email">${data.referred_by.email || 'Email hidden for admin account'}</div>
                        <div class="user-number">#${data.referred_by.referral_code || 'N/A'}</div>
                    </div>
                `;
            } else {
                referredBySection.style.display = 'none';
            }
            
            // Render referrals table
            const refTable = document.getElementById('userReferralsTable');
            if (data.direct_referrals.length > 0) {
                refTable.innerHTML = data.direct_referrals.map(ref => `
                    <tr>
                        <td><strong>#${ref.referral_code || 'N/A'}</strong></td>
                        <td>${ref.full_name}</td>
                        <td>${ref.email || 'Hidden for admin account'}</td>
                        <td><span class="status-${ref.status}">${ref.status}</span></td>
                        <td>$${ref.total_invested.toFixed(2)}</td>
                        <td>${ref.level2_referrals}</td>
                        <td>${new Date(ref.joined_date).toLocaleDateString()}</td>
                    </tr>
                `).join('');
            } else {
                refTable.innerHTML = '<tr><td colspan="7" class="empty">No referrals found</td></tr>';
            }
        }
    } catch (error) {
        console.error('Error loading user referrals:', error);
    }
}

// ==================== WITHDRAWALS MANAGEMENT ====================

// Store all withdrawals for filtering
let allWithdrawalsData = [];

async function loadWithdrawals() {
    const tbody = document.getElementById('withdrawalsTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Loading withdrawals...</td></tr>';
    
    const statusFilter = document.getElementById('withdrawalFilter').value;
    let url = `${API_URL}/api/admin/withdrawals`;
    if (statusFilter) {
        url += `?status=${statusFilter}`;
    }
    
    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            allWithdrawalsData = data.withdrawals || [];
            
            // Apply date filter
            const filteredWithdrawals = filterWithdrawalsByDate(allWithdrawalsData);
            
            // Calculate summary from filtered data
            const summary = calculateWithdrawalsSummary(filteredWithdrawals);
            document.getElementById('pendingCount').textContent = summary.total_pending;
            document.getElementById('pendingAmount').textContent = summary.pending_amount.toFixed(2);
            document.getElementById('approvedCount').textContent = summary.total_approved;
            document.getElementById('approvedAmount').textContent = summary.approved_amount.toFixed(2);
            document.getElementById('cancelledCount').textContent = summary.total_cancelled;
            document.getElementById('cancelledAmount').textContent = summary.cancelled_amount.toFixed(2);
            document.getElementById('totalWithdrawnAmount').textContent = `$${summary.total_withdrawn.toFixed(2)}`;
            
            renderWithdrawalsTable(filteredWithdrawals);
        }
    } catch (error) {
        console.error('Error loading withdrawals:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="loading">Error loading withdrawals</td></tr>';
    }
}

function filterWithdrawalsByDate(withdrawals) {
    const filter = document.getElementById('withdrawalDateFilter').value;
    if (!filter || filter === '') return withdrawals;
    
    const now = new Date();
    let startDate = null;
    let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    
    if (filter === 'weekly') {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
    } else if (filter === 'monthly') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (filter === 'quarterly') {
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
    } else if (filter === 'yearly') {
        startDate = new Date(now.getFullYear(), 0, 1);
    } else if (filter === 'custom') {
        const customStart = document.getElementById('withdrawalStartDate').value;
        const customEnd = document.getElementById('withdrawalEndDate').value;
        if (customStart) startDate = new Date(customStart);
        if (customEnd) {
            endDate = new Date(customEnd);
            endDate.setHours(23, 59, 59, 999);
        }
    }
    
    if (!startDate) return withdrawals;
    
    return withdrawals.filter(w => {
        const wDate = new Date(w.created_at);
        return wDate >= startDate && wDate <= endDate;
    });
}

function calculateWithdrawalsSummary(withdrawals) {
    const summary = {
        total_pending: 0,
        pending_amount: 0,
        total_approved: 0,
        approved_amount: 0,
        total_cancelled: 0,
        cancelled_amount: 0,
        total_withdrawn: 0
    };
    
    withdrawals.forEach(w => {
        if (w.status === 'pending') {
            summary.total_pending++;
            summary.pending_amount += w.amount || 0;
        } else if (w.status === 'approved') {
            summary.total_approved++;
            summary.approved_amount += w.amount || 0;
            summary.total_withdrawn += w.amount || 0;
        } else if (w.status === 'cancelled') {
            summary.total_cancelled++;
            summary.cancelled_amount += w.amount || 0;
        }
    });
    
    return summary;
}

function renderWithdrawalsTable(withdrawals) {
    const tbody = document.getElementById('withdrawalsTableBody');
    
    if (!withdrawals || withdrawals.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading">No withdrawal requests found for selected period</td></tr>';
        return;
    }
    
    tbody.innerHTML = '';
    withdrawals.forEach(w => {
        const statusColors = {
            'pending': '#f39c12',
            'approved': '#27ae60',
            'cancelled': '#e74c3c'
        };
        
        const paymentDetails = w.upi_id ? `UPI: ${w.upi_id}` : (w.bank_details || 'N/A');
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>#${w.referral_code || 'N/A'}</strong></td>
            <td>${w.user_name}<br><small>${w.user_email}</small></td>
            <td><strong>$${w.amount.toFixed(2)}</strong></td>
            <td>${paymentDetails}</td>
            <td><span class="type-badge" style="background: ${statusColors[w.status]}">${w.status}</span></td>
            <td>${new Date(w.created_at).toLocaleString()}</td>
            <td>
                ${w.status === 'pending' ? `
                    <button class="action-btn btn-success" onclick="approveWithdrawal('${w.id}')">Approve</button>
                    <button class="action-btn btn-danger" onclick="cancelWithdrawal('${w.id}')">Cancel</button>
                ` : '-'}
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function approveWithdrawal(withdrawalId) {
    if (!confirm('Are you sure you want to approve this withdrawal? This will deduct from user wallet.')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/withdrawals/${withdrawalId}/approve`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            alert('Withdrawal approved successfully!');
            loadWithdrawals();
            loadDashboardData();
        } else {
            const error = await response.json();
            alert(error.detail || 'Failed to approve withdrawal');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to approve withdrawal');
    }
}

async function cancelWithdrawal(withdrawalId) {
    if (!confirm('Are you sure you want to cancel this withdrawal request?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/withdrawals/${withdrawalId}/cancel`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            alert('Withdrawal cancelled');
            loadWithdrawals();
        } else {
            alert('Failed to cancel withdrawal');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to cancel withdrawal');
    }
}

// ==================== WALLET MANAGEMENT ====================

async function loadWallets() {
    const tbody = document.getElementById('walletsTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="loading">Loading wallets...</td></tr>';
    
    try {
        const response = await fetch(`${API_URL}/api/admin/wallets`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            if (!data.wallets || data.wallets.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="loading">No wallets found</td></tr>';
                return;
            }
            
            tbody.innerHTML = '';
            data.wallets.forEach(wallet => {
                const total = (wallet.daily_roi || 0) + (wallet.direct_income || 0) + 
                             (wallet.slab_income || 0) + (wallet.royalty_income || 0) + 
                             (wallet.salary_income || 0);
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${wallet.user_email || 'N/A'}<br><small>${wallet.user_name || ''}</small></td>
                    <td class="income-col">$${(wallet.daily_roi || 0).toFixed(2)}</td>
                    <td class="income-col">$${(wallet.direct_income || 0).toFixed(2)}</td>
                    <td class="income-col">$${(wallet.slab_income || 0).toFixed(2)}</td>
                    <td class="income-col">$${(wallet.royalty_income || 0).toFixed(2)}</td>
                    <td class="income-col">$${(wallet.salary_income || 0).toFixed(2)}</td>
                    <td class="total-col">$${total.toFixed(2)}</td>
                    <td>
                        <button class="action-btn btn-view" onclick="viewUser('${wallet.user_id}')">Manage</button>
                    </td>
                `;
                tbody.appendChild(row);
            });
        }
    } catch (error) {
        console.error('Error loading wallets:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="loading">Error loading wallets</td></tr>';
    }
}

// Credit/Debit Income
async function creditIncome() {
    if (!currentUserId) return;
    
    const incomeType = document.getElementById('incomeType').value;
    const amount = parseFloat(document.getElementById('incomeAmount').value);
    const description = document.getElementById('incomeDescription').value;
    
    if (!amount || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/${currentUserId}/credit-income`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                income_type: incomeType,
                amount: amount,
                description: description || `Manual ${incomeType} credit`
            })
        });
        
        if (response.ok) {
            alert('Income credited successfully!');
            document.getElementById('incomeAmount').value = '';
            document.getElementById('incomeDescription').value = '';
            viewUser(currentUserId);
        } else {
            const error = await response.json();
            alert(error.detail || 'Failed to credit income');
        }
    } catch (error) {
        console.error('Error crediting income:', error);
        alert('Failed to credit income');
    }
}

async function debitIncome() {
    if (!currentUserId) return;
    
    const incomeType = document.getElementById('incomeType').value;
    const amount = parseFloat(document.getElementById('incomeAmount').value);
    const description = document.getElementById('incomeDescription').value;
    
    if (!amount || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }
    
    if (!confirm(`Are you sure you want to debit $${amount} from ${incomeType}?`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/${currentUserId}/debit-income`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                income_type: incomeType,
                amount: amount,
                description: description || `Manual ${incomeType} debit`
            })
        });
        
        if (response.ok) {
            alert('Income debited successfully!');
            document.getElementById('incomeAmount').value = '';
            document.getElementById('incomeDescription').value = '';
            viewUser(currentUserId);
        } else {
            const error = await response.json();
            alert(error.detail || 'Failed to debit income');
        }
    } catch (error) {
        console.error('Error debiting income:', error);
        alert('Failed to debit income');
    }
}

// ==================== INCOME CALCULATIONS ====================

async function calculateDailyROI(type) {
    const rate = type === 'premium' ? 1 : 0.5;
    if (!confirm(`This will calculate ${rate}% daily ROI for all users with investments. Continue?`)) {
        return;
    }
    
    const resultDiv = document.getElementById('roiResult');
    if (resultDiv) {
        resultDiv.textContent = 'Calculating ROI...';
        resultDiv.className = 'result-message';
        resultDiv.style.display = 'block';
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/calculate-daily-roi?roi_type=${type}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (resultDiv) {
                resultDiv.textContent = `✅ ${data.message}. Total distributed: $${(data.total_distributed || 0).toFixed(2)}`;
                resultDiv.className = 'result-message success';
            }
            alert(`ROI calculated! Total distributed: $${(data.total_distributed || 0).toFixed(2)}`);
            loadDashboardData();
        } else {
            if (resultDiv) {
                resultDiv.textContent = '❌ Failed to calculate ROI';
                resultDiv.className = 'result-message error';
            }
        }
    } catch (error) {
        console.error('Error:', error);
        if (resultDiv) {
            resultDiv.textContent = '❌ Error calculating ROI';
            resultDiv.className = 'result-message error';
        }
    }
}

async function calculateDirectIncome() {
    if (!confirm('This will calculate 5% direct income for all referrers. Continue?')) return;
    
    const resultDiv = document.getElementById('directResult');
    if (resultDiv) {
        resultDiv.textContent = 'Calculating...';
        resultDiv.style.display = 'block';
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/calculate-direct-income`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (resultDiv) {
                resultDiv.textContent = `✅ ${data.message}. Total: $${(data.total_distributed || 0).toFixed(2)}`;
                resultDiv.className = 'result-message success';
            }
            loadDashboardData();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function calculateSlabIncome() {
    if (!confirm('This will calculate slab income based on team volumes. Continue?')) return;
    
    const resultDiv = document.getElementById('slabResult');
    if (resultDiv) {
        resultDiv.textContent = 'Calculating...';
        resultDiv.style.display = 'block';
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/calculate-slab-income`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (resultDiv) {
                resultDiv.textContent = `✅ ${data.message}. Total: $${(data.total_distributed || 0).toFixed(2)}`;
                resultDiv.className = 'result-message success';
            }
            loadDashboardData();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function calculateRoyaltyIncome() {
    if (!confirm('This will calculate royalty income (L1: 10%, L2: 5%, L3: 5%). Continue?')) return;
    
    const resultDiv = document.getElementById('royaltyResult');
    if (resultDiv) {
        resultDiv.textContent = 'Calculating...';
        resultDiv.style.display = 'block';
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/calculate-royalty-income`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (resultDiv) {
                resultDiv.textContent = `✅ ${data.message}. Total: $${(data.total_distributed || 0).toFixed(2)}`;
                resultDiv.className = 'result-message success';
            }
            loadDashboardData();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ==================== SALARY INCOME (AUTOMATIC) ====================

async function calculateSalaryIncome() {
    if (!confirm('This will calculate and distribute monthly salary to eligible users (40/60 rule). Continue?')) return;
    
    const resultDiv = document.getElementById('salaryAutoResult');
    if (resultDiv) {
        resultDiv.textContent = 'Calculating salary income...';
        resultDiv.className = 'result-message';
        resultDiv.style.display = 'block';
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/calculate-salary-income`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (resultDiv) {
                resultDiv.innerHTML = `✅ ${data.message}<br>Total Distributed: <strong>$${(data.total_distributed || 0).toFixed(2)}</strong>`;
                resultDiv.className = 'result-message success';
            }
            loadDashboardData();
            viewSalaryStatus(); // Refresh the status table
        } else {
            const errorData = await response.json();
            if (resultDiv) {
                resultDiv.textContent = `❌ Error: ${errorData.detail || 'Failed to calculate salary'}`;
                resultDiv.className = 'result-message error';
            }
        }
    } catch (error) {
        console.error('Error:', error);
        if (resultDiv) {
            resultDiv.textContent = '❌ Network error. Please try again.';
            resultDiv.className = 'result-message error';
        }
    }
}

async function viewSalaryStatus() {
    const section = document.getElementById('salaryStatusSection');
    const tbody = document.getElementById('salaryStatusTableBody');
    
    if (section) section.style.display = 'block';
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="loading">Loading salary status...</td></tr>';
    
    try {
        const response = await fetch(`${API_URL}/api/admin/salary-status`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            if (!data.users || data.users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="loading">No users found</td></tr>';
                return;
            }
            
            tbody.innerHTML = '';
            data.users.forEach(user => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>
                        <strong>#${user.referral_code || 'N/A'}</strong><br>
                        <small>${user.full_name}</small>
                    </td>
                    <td><strong>$${(user.business_volume || 0).toFixed(2)}</strong></td>
                    <td>${user.power_leg_percent || 0}%</td>
                    <td>${user.weaker_legs_percent || 0}%</td>
                    <td>
                        ${user.eligible 
                            ? '<span class="status-badge status-active">Yes</span>' 
                            : '<span class="status-badge status-inactive">No</span>'}
                    </td>
                    <td><strong>${user.current_tier || 'None'}</strong></td>
                    <td>${user.months_paid || 0} / 10</td>
                    <td style="color: #27ae60;"><strong>$${(user.total_salary_earned || 0).toFixed(2)}</strong></td>
                `;
                tbody.appendChild(row);
            });
        }
    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="loading">Error loading salary status</td></tr>';
    }
}

async function loadUsersForSalary() {
    try {
        const response = await fetch(`${API_URL}/api/admin/users?limit=100`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            const select = document.getElementById('salaryUserId');
            select.innerHTML = '<option value="">Select User</option>';
            
            data.users.forEach(user => {
                if (!user.is_admin) {
                    select.innerHTML += `<option value="${user.id}">#${user.referral_code || 'N/A'} - ${user.full_name} (${user.email})</option>`;
                }
            });
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function creditSalaryIncome() {
    const userId = document.getElementById('salaryUserId').value;
    const amount = parseFloat(document.getElementById('salaryAmount').value);
    
    if (!userId) { alert('Please select a user'); return; }
    if (!amount || amount <= 0) { alert('Please enter a valid amount'); return; }
    
    const resultDiv = document.getElementById('salaryResult');
    if (resultDiv) {
        resultDiv.textContent = 'Crediting...';
        resultDiv.style.display = 'block';
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/${userId}/credit-income`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                income_type: 'salary_income',
                amount: amount,
                description: 'Monthly Salary Income'
            })
        });
        
        if (response.ok) {
            if (resultDiv) {
                resultDiv.textContent = `✅ Salary of $${amount.toFixed(2)} credited!`;
                resultDiv.className = 'result-message success';
            }
            document.getElementById('salaryAmount').value = '';
            loadDashboardData();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// ==================== INVESTMENTS ====================

// Store all investments for filtering
let allInvestmentsData = [];

function getUserReferralCode(record) {
    return (
        record?.referral_code ||
        record?.user_referral_code ||
        record?.user_code ||
        record?.user?.referral_code ||
        'N/A'
    );
}

async function loadInvestments() {
    const tbody = document.getElementById('investmentsTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Loading investments...</td></tr>';
    
    try {
        const response = await fetch(`${API_URL}/api/admin/investments?limit=1000`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            allInvestmentsData = data.investments || [];
            
            // Apply date filter
            const filteredInvestments = filterInvestmentsByDate(allInvestmentsData);
            renderInvestmentsTable(filteredInvestments);
        }
    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="loading">Error loading investments</td></tr>';
    }
}

function filterInvestmentsByDate(investments) {
    const filter = document.getElementById('investmentDateFilter')?.value;
    if (!filter || filter === '') return investments;
    
    const now = new Date();
    let startDate = null;
    let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    
    if (filter === 'weekly') {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
    } else if (filter === 'monthly') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (filter === 'quarterly') {
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
    } else if (filter === 'yearly') {
        startDate = new Date(now.getFullYear(), 0, 1);
    } else if (filter === 'custom') {
        const customStart = document.getElementById('investmentStartDate')?.value;
        const customEnd = document.getElementById('investmentEndDate')?.value;
        if (customStart) startDate = new Date(customStart);
        if (customEnd) {
            endDate = new Date(customEnd);
            endDate.setHours(23, 59, 59, 999);
        }
    }
    
    if (!startDate) return investments;
    
    return investments.filter(inv => {
        const invDate = new Date(inv.date);
        return invDate >= startDate && invDate <= endDate;
    });
}

function renderInvestmentsTable(investments) {
    const tbody = document.getElementById('investmentsTableBody');
    
    // Update summary
    const totalAmount = investments.reduce((sum, inv) => sum + (inv.amount || 0), 0);
    const summaryEl = document.getElementById('investmentSummary');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <span class="badge" style="background: var(--success); color: #fff; padding: 6px 12px; border-radius: 20px; margin-right: 10px;">
                ${investments.length} Investments
            </span>
            <span class="badge" style="background: var(--primary); color: #000; padding: 6px 12px; border-radius: 20px;">
                Total: $${totalAmount.toFixed(2)}
            </span>
        `;
    }
    
    if (!investments || investments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading">No investments found for selected period</td></tr>';
        return;
    }
    
    tbody.innerHTML = '';
    investments.forEach(investment => {
        const slabRate = getSlabRate(investment.amount);
        const referralCode = getUserReferralCode(investment);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>#${referralCode}</strong></td>
            <td>${investment.user_name || 'Unknown'}</td>
            <td>${investment.user_email || 'N/A'}</td>
            <td><strong>$${(investment.amount || 0).toFixed(2)}</strong></td>
            <td><span class="slab-badge">${slabRate}%</span></td>
            <td>${new Date(investment.date).toLocaleString()}</td>
            <td><span class="status-${investment.status}">${investment.status}</span></td>
        `;
        tbody.appendChild(row);
    });
}

function applyInvestmentDateFilter() {
    const filter = document.getElementById('investmentDateFilter').value;
    const customRange = document.getElementById('investmentCustomDateRange');
    
    if (filter === 'custom') {
        customRange.style.display = 'flex';
    } else {
        customRange.style.display = 'none';
        if (allInvestmentsData.length > 0) {
            const filteredInvestments = filterInvestmentsByDate(allInvestmentsData);
            renderInvestmentsTable(filteredInvestments);
        } else {
            loadInvestments();
        }
    }
}

function exportInvestmentsToExcel() {
    showExportDateModal('investments');
}

async function doExportInvestments(startDate, endDate) {
    try {
        let investments = [...allInvestmentsData];
        
        if (investments.length === 0) {
            const response = await fetch(`${API_URL}/api/admin/investments?limit=1000`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            if (response.ok) {
                const data = await response.json();
                investments = data.investments || [];
            }
        }
        
        // Apply date filter if specified
        if (startDate) {
            investments = investments.filter(inv => {
                const invDate = new Date(inv.date);
                return invDate >= startDate && invDate <= endDate;
            });
        }
        
        const exportData = investments.map(inv => ({
            'ID': getUserReferralCode(inv),
            'Name': inv.user_name || 'Unknown',
            'Email': inv.user_email || 'N/A',
            'Amount': inv.amount,
            'Slab Rate': getSlabRate(inv.amount) + '%',
            'Status': inv.status,
            'Date': new Date(inv.date).toLocaleDateString()
        }));
        
        const dateLabel = startDate ? `_${startDate.toISOString().split('T')[0]}_to_${endDate.toISOString().split('T')[0]}` : '';
        exportToExcel(exportData, `investments${dateLabel}`);
    } catch (error) {
        console.error('Error exporting:', error);
        alert('Failed to export data');
    }
}

function getSlabRate(amount) {
    if (amount >= 1000000) return 45;
    if (amount >= 500000) return 40;
    if (amount >= 200000) return 35;
    if (amount >= 100000) return 30;
    if (amount >= 50000) return 25;
    if (amount >= 25000) return 20;
    if (amount >= 10000) return 15;
    if (amount >= 5000) return 10;
    if (amount >= 1000) return 5;
    return 0;
}

// ==================== TRANSACTIONS ====================

// Store all transactions for filtering
let allTransactionsData = [];

async function loadTransactions() {
    const tbody = document.getElementById('transactionsTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading transactions...</td></tr>';
    
    try {
        const response = await fetch(`${API_URL}/api/admin/transactions?limit=1000`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            allTransactionsData = data.transactions || [];
            allTransactions = [...allTransactionsData]; // For existing filter compatibility
            
            // Apply both type and date filters
            const filteredTransactions = filterTransactionsByDate(allTransactionsData);
            renderTransactions(filteredTransactions);
        }
    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="loading">Error loading transactions</td></tr>';
    }
}

function filterTransactionsByDate(transactions) {
    const filter = document.getElementById('transactionDateFilter')?.value;
    if (!filter || filter === '') return transactions;
    
    const now = new Date();
    let startDate = null;
    let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    
    if (filter === 'weekly') {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
    } else if (filter === 'monthly') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (filter === 'quarterly') {
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
    } else if (filter === 'yearly') {
        startDate = new Date(now.getFullYear(), 0, 1);
    } else if (filter === 'custom') {
        const customStart = document.getElementById('transactionStartDate')?.value;
        const customEnd = document.getElementById('transactionEndDate')?.value;
        if (customStart) startDate = new Date(customStart);
        if (customEnd) {
            endDate = new Date(customEnd);
            endDate.setHours(23, 59, 59, 999);
        }
    }
    
    if (!startDate) return transactions;
    
    return transactions.filter(t => {
        const tDate = new Date(t.date);
        return tDate >= startDate && tDate <= endDate;
    });
}

function renderTransactions(transactions) {
    const tbody = document.getElementById('transactionsTableBody');
    
    // Update summary
    const totalAmount = transactions.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
    const summaryEl = document.getElementById('transactionSummary');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <span class="badge" style="background: var(--info); color: #fff; padding: 6px 12px; border-radius: 20px; margin-right: 10px;">
                ${transactions.length} Transactions
            </span>
            <span class="badge" style="background: var(--primary); color: #000; padding: 6px 12px; border-radius: 20px;">
                Total: $${totalAmount.toFixed(2)}
            </span>
        `;
    }
    
    if (!transactions || transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading">No transactions found for selected period</td></tr>';
        return;
    }
    
    const typeColors = {
        'daily_roi': '#27ae60',
        'direct_income': '#3498db',
        'slab_income': '#9b59b6',
        'royalty_income': '#f39c12',
        'salary_income': '#e74c3c',
        'investment': '#1abc9c',
        'withdrawal': '#c0392b'
    };
    
    tbody.innerHTML = '';
    transactions.forEach(transaction => {
        const referralCode = getUserReferralCode(transaction);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>#${referralCode}</strong></td>
            <td>${transaction.user_name || 'Unknown'}</td>
            <td><span class="type-badge" style="background: ${typeColors[transaction.type] || '#999'}">${transaction.type.replace(/_/g, ' ')}</span></td>
            <td style="color: ${transaction.amount < 0 ? '#e74c3c' : '#27ae60'}">$${Math.abs(transaction.amount || 0).toFixed(2)}</td>
            <td>${transaction.description || '-'}</td>
            <td>${new Date(transaction.date).toLocaleString()}</td>
        `;
        tbody.appendChild(row);
    });
}

function filterTransactions() {
    const typeFilter = document.getElementById('transactionFilter').value;
    
    // Start with date-filtered data
    let filtered = filterTransactionsByDate(allTransactionsData);
    
    // Then apply type filter
    if (typeFilter !== 'all') {
        filtered = filtered.filter(t => t.type === typeFilter);
    }
    
    renderTransactions(filtered);
}

function applyTransactionDateFilter() {
    const filter = document.getElementById('transactionDateFilter').value;
    const customRange = document.getElementById('transactionCustomDateRange');
    
    if (filter === 'custom') {
        customRange.style.display = 'flex';
    } else {
        customRange.style.display = 'none';
        filterTransactions(); // Re-apply all filters
    }
}

function exportTransactionsToExcel() {
    showExportDateModal('transactions');
}

async function doExportTransactions(startDate, endDate) {
    try {
        let transactions = [...allTransactionsData];
        
        if (transactions.length === 0) {
            const response = await fetch(`${API_URL}/api/admin/transactions?limit=1000`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            if (response.ok) {
                const data = await response.json();
                transactions = data.transactions || [];
            }
        }
        
        // Apply date filter if specified
        if (startDate) {
            transactions = transactions.filter(t => {
                const tDate = new Date(t.date);
                return tDate >= startDate && tDate <= endDate;
            });
        }
        
        const exportData = transactions.map(t => ({
            'ID': getUserReferralCode(t),
            'User': t.user_name || 'Unknown',
            'Type': t.type?.replace(/_/g, ' ') || 'N/A',
            'Amount': t.amount,
            'Description': t.description || '-',
            'Date': new Date(t.date).toLocaleDateString()
        }));
        
        const dateLabel = startDate ? `_${startDate.toISOString().split('T')[0]}_to_${endDate.toISOString().split('T')[0]}` : '';
        exportToExcel(exportData, `transactions${dateLabel}`);
    } catch (error) {
        console.error('Error exporting:', error);
        alert('Failed to export data');
    }
}

// Delete User
async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            alert('User deleted successfully');
            loadUsers();
        } else {
            alert('Failed to delete user');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to delete user');
    }
}

// Search handlers
document.getElementById('userSearch')?.addEventListener('input', function() {
    applyUsersFiltersAndRender();
});

document.getElementById('walletSearch')?.addEventListener('input', function(e) {
    const searchTerm = e.target.value.toLowerCase();
    const rows = document.querySelectorAll('#walletsTableBody tr');
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
});

window.addEventListener('click', function(event) {
    const modal = document.getElementById('userModal');
    if (event.target === modal) {
        closeUserModal();
    }
});

// ==================== P2P TRANSFER FUNCTIONS ====================

async function loadP2PTransfers() {
    const tbody = document.getElementById('p2pTransfersTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading transfers...</td></tr>';
    
    try {
        const response = await fetch(`${API_URL}/api/admin/p2p/transfers?limit=50`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.transfers.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="loading">No P2P transfers yet</td></tr>';
                return;
            }
            
            tbody.innerHTML = '';
            data.transfers.forEach(transfer => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>
                        <strong>#${transfer.sender_referral_code || 'N/A'}</strong><br>
                        <small>${transfer.sender_name}</small>
                    </td>
                    <td>
                        <strong>#${transfer.recipient_referral_code || 'N/A'}</strong><br>
                        <small>${transfer.recipient_name}</small>
                    </td>
                    <td style="color: #27ae60; font-weight: bold;">$${transfer.amount.toFixed(2)}</td>
                    <td>${transfer.admin_initiated ? '<span class="status-badge status-active">Yes</span>' : '<span class="status-badge status-inactive">No</span>'}</td>
                    <td>${transfer.description || '-'}</td>
                    <td>${new Date(transfer.completed_at).toLocaleString()}</td>
                `;
                tbody.appendChild(row);
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="6" class="loading">Failed to load transfers</td></tr>';
        }
    } catch (error) {
        console.error('Error loading P2P transfers:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="loading">Error loading transfers</td></tr>';
    }
}

async function executeP2PTransfer() {
    const senderReferralCode = document.getElementById('p2pSenderUserId').value.trim();
    const recipientReferralCode = document.getElementById('p2pRecipientUserId').value.trim();
    const amount = parseFloat(document.getElementById('p2pAmount').value);
    const description = document.getElementById('p2pDescription').value;
    const resultDiv = document.getElementById('p2pResult');
    
    // Validation
    if (!senderReferralCode || !recipientReferralCode) {
        showP2PResult('Please enter both Sender and Recipient referral codes', 'error');
        return;
    }
    
    if (!amount || amount <= 0) {
        showP2PResult('Please enter a valid amount', 'error');
        return;
    }
    
    if (senderReferralCode === recipientReferralCode) {
        showP2PResult('Sender and Recipient cannot be the same', 'error');
        return;
    }
    
    if (!confirm(`Are you sure you want to transfer $${amount.toFixed(2)} from #${senderReferralCode} to #${recipientReferralCode}?`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/p2p/transfer`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sender_referral_code: senderReferralCode,
                recipient_referral_code: recipientReferralCode,
                amount: amount,
                description: description
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showP2PResult(
                `Transfer Successful! $${amount.toFixed(2)} transferred from ${data.sender.name} (#${data.sender.referral_code || 'N/A'}) to ${data.recipient.name} (#${data.recipient.referral_code || 'N/A'})`,
                'success'
            );
            // Clear form
            document.getElementById('p2pSenderUserId').value = '';
            document.getElementById('p2pRecipientUserId').value = '';
            document.getElementById('p2pAmount').value = '';
            document.getElementById('p2pDescription').value = '';
            // Reload transfers list
            loadP2PTransfers();
        } else {
            showP2PResult(data.detail || 'Transfer failed. Please try again.', 'error');
        }
    } catch (error) {
        console.error('Error executing P2P transfer:', error);
        showP2PResult('Network error. Please try again.', 'error');
    }
}

function showP2PResult(message, type) {
    const resultDiv = document.getElementById('p2pResult');
    resultDiv.textContent = message;
    resultDiv.className = `result-message ${type}`;
    resultDiv.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(() => {
            resultDiv.style.display = 'none';
        }, 5000);
    }
}

// Referral code lookup on input change
document.getElementById('p2pSenderUserId')?.addEventListener('blur', async function() {
    const referralCode = this.value.trim().toUpperCase();
    const infoDiv = document.getElementById('senderInfo');
    
    if (!referralCode) {
        infoDiv.style.display = 'none';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users?limit=100`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            const user = data.users.find(u => (u.referral_code || '').toUpperCase() === referralCode);
            
            if (user) {
                const totalBalance = (user.wallet?.daily_roi || 0) + (user.wallet?.direct_income || 0) + 
                                   (user.wallet?.slab_income || 0) + (user.wallet?.royalty_income || 0) + 
                                   (user.wallet?.salary_income || 0);
                infoDiv.innerHTML = `<span style="color: #27ae60;">✓ ${user.full_name}</span> | Main Wallet: <strong>$${totalBalance.toFixed(2)}</strong>`;
                infoDiv.style.display = 'block';
            } else {
                infoDiv.innerHTML = '<span style="color: #e74c3c;">✗ User not found</span>';
                infoDiv.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Error looking up user:', error);
    }
});

document.getElementById('p2pRecipientUserId')?.addEventListener('blur', async function() {
    const referralCode = this.value.trim().toUpperCase();
    const infoDiv = document.getElementById('recipientInfo');
    
    if (!referralCode) {
        infoDiv.style.display = 'none';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users?limit=100`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            const user = data.users.find(u => (u.referral_code || '').toUpperCase() === referralCode);
            
            if (user) {
                infoDiv.innerHTML = `<span style="color: #27ae60;">✓ ${user.full_name}</span> | Status: ${user.status === 'active' ? '<span style="color:#27ae60;">Active</span>' : '<span style="color:#e74c3c;">Inactive</span>'}`;
                infoDiv.style.display = 'block';
            } else {
                infoDiv.innerHTML = '<span style="color: #e74c3c;">✗ User not found</span>';
                infoDiv.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Error looking up user:', error);
    }
});

// ==================== ADMIN CREATE USER ====================

function showAddUserModal() {
    document.getElementById('addUserModal').style.display = 'flex';
    // Clear form
    document.getElementById('newUserName').value = '';
    document.getElementById('newUserEmail').value = '';
    document.getElementById('newUserPassword').value = '';
    document.getElementById('newUserStatus').value = 'active';
    document.getElementById('newUserReferrer').value = '';
    document.getElementById('addUserMessage').style.display = 'none';
}

function closeAddUserModal() {
    document.getElementById('addUserModal').style.display = 'none';
}

async function createUser() {
    const name = document.getElementById('newUserName').value.trim();
    const email = document.getElementById('newUserEmail').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const status = document.getElementById('newUserStatus').value;
    const referrer = document.getElementById('newUserReferrer').value.trim();
    const messageDiv = document.getElementById('addUserMessage');
    
    if (!name || !email || !password) {
        messageDiv.textContent = 'Please fill in all required fields';
        messageDiv.className = 'message error';
        messageDiv.style.display = 'block';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                full_name: name,
                email: email,
                password: password,
                status: status,
                referral_code: referrer || null
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            messageDiv.textContent = `User created successfully! Referral Code: #${data.user.referral_code}`;
            messageDiv.className = 'message success';
            messageDiv.style.display = 'block';
            
            // Refresh users list
            setTimeout(() => {
                closeAddUserModal();
                loadUsers();
            }, 1500);
        } else {
            messageDiv.textContent = data.detail || 'Failed to create user';
            messageDiv.className = 'message error';
            messageDiv.style.display = 'block';
        }
    } catch (error) {
        console.error('Error creating user:', error);
        messageDiv.textContent = 'Network error. Please try again.';
        messageDiv.className = 'message error';
        messageDiv.style.display = 'block';
    }
}

// ==================== ADMIN CREATED USERS HISTORY ====================

function showAdminCreatedUsers() {
    document.getElementById('adminCreatedUsersModal').style.display = 'flex';
    loadAdminCreatedUsers();
}

function closeAdminCreatedUsersModal() {
    document.getElementById('adminCreatedUsersModal').style.display = 'none';
}

// Store admin created users for filtering
let allAdminCreatedUsersData = [];

async function loadAdminCreatedUsers() {
    // Reset selection
    selectedAdminCreatedIds = [];
    updateAdminCreatedBulkActions();
    
    const tbody = document.getElementById('adminCreatedUsersTable');
    tbody.innerHTML = '<tr><td colspan="9" class="loading">Loading...</td></tr>';
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/created-by-admin`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            allAdminCreatedUsersData = data.users || [];
            
            // Apply date filter
            const filteredUsers = filterAdminCreatedUsersByDate(allAdminCreatedUsersData);
            renderAdminCreatedUsersTable(filteredUsers);
        }
    } catch (error) {
        console.error('Error loading admin created users:', error);
        tbody.innerHTML = '<tr><td colspan="9" class="empty">Error loading users</td></tr>';
    }
}

function filterAdminCreatedUsersByDate(users) {
    const filter = document.getElementById('adminCreatedDateFilter').value;
    if (!filter || filter === '') return users;
    
    const now = new Date();
    let startDate = null;
    let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    
    if (filter === 'weekly') {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
    } else if (filter === 'monthly') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (filter === 'quarterly') {
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
    } else if (filter === 'yearly') {
        startDate = new Date(now.getFullYear(), 0, 1);
    } else if (filter === 'custom') {
        const customStart = document.getElementById('adminCreatedStartDate').value;
        const customEnd = document.getElementById('adminCreatedEndDate').value;
        if (customStart) startDate = new Date(customStart);
        if (customEnd) {
            endDate = new Date(customEnd);
            endDate.setHours(23, 59, 59, 999);
        }
    }
    
    if (!startDate) return users;
    
    return users.filter(user => {
        const userDate = new Date(user.created_at);
        return userDate >= startDate && userDate <= endDate;
    });
}

function renderAdminCreatedUsersTable(users) {
    const tbody = document.getElementById('adminCreatedUsersTable');
    
    // Update summary with filtered count
    document.getElementById('adminCreatedSummary').innerHTML = `
        <span class="badge" style="background: var(--primary); color: #000; padding: 8px 16px; border-radius: 20px;">
            Total Users Created: ${users.length}
        </span>
    `;
    
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty">No users found for selected period</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(user => `
        <tr>
            <td><input type="checkbox" value="${user.id}" onchange="toggleAdminCreatedSelection('${user.id}')"></td>
            <td><strong>#${user.referral_code || 'N/A'}</strong></td>
            <td>${user.full_name}</td>
            <td>${user.email}</td>
            <td><span class="status-${user.status}">${user.status}</span></td>
            <td>$${(user.total_invested || 0).toFixed(2)}</td>
            <td>Admin</td>
            <td>${new Date(user.created_at).toLocaleDateString()}</td>
            <td class="action-buttons">
                <button class="btn btn-info btn-sm" onclick="viewUser('${user.id}')">Manage</button>
                <button class="btn ${user.status === 'active' ? 'btn-warning' : 'btn-success'} btn-sm" onclick="deactivateUser('${user.id}')">${user.status === 'active' ? 'Deact.' : 'Act.'}</button>
                <button class="btn btn-danger btn-sm" onclick="deleteUser('${user.id}')">Del</button>
            </td>
        </tr>
    `).join('');
}

// ==================== EDIT USER EMAIL ====================

async function updateUserEmail() {
    const newEmail = document.getElementById('editUserEmail').value.trim();
    const messageDiv = document.getElementById('editUserMessage');
    
    if (!newEmail) {
        messageDiv.textContent = 'Please enter a new email';
        messageDiv.className = 'message error';
        messageDiv.style.display = 'block';
        return;
    }
    
    if (!currentUserId) {
        messageDiv.textContent = 'No user selected';
        messageDiv.className = 'message error';
        messageDiv.style.display = 'block';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/${currentUserId}/email`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email: newEmail })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            messageDiv.textContent = 'Email updated successfully!';
            messageDiv.className = 'message success';
            messageDiv.style.display = 'block';
            
            // Refresh user details
            setTimeout(() => {
                viewUser(currentUserId);
                loadUsers();
            }, 1000);
        } else {
            messageDiv.textContent = data.detail || 'Failed to update email';
            messageDiv.className = 'message error';
            messageDiv.style.display = 'block';
        }
    } catch (error) {
        console.error('Error updating email:', error);
        messageDiv.textContent = 'Network error. Please try again.';
        messageDiv.className = 'message error';
        messageDiv.style.display = 'block';
    }
}

// ==================== CHANGE USER REFERRER ====================

// Lookup new referrer when typing
document.getElementById('newReferrerCode')?.addEventListener('blur', async function() {
    const code = this.value.trim();
    const infoDiv = document.getElementById('newReferrerInfo');
    
    if (!code) {
        infoDiv.style.display = 'none';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/lookup-user/${encodeURIComponent(code)}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const user = await response.json();
            infoDiv.innerHTML = `<span style="color: #27ae60;">✓ Found: ${user.full_name} (#${user.referral_code || 'N/A'}) - ${user.status}</span>`;
            infoDiv.style.display = 'block';
        } else {
            infoDiv.innerHTML = `<span style="color: #e74c3c;">✗ User not found</span>`;
            infoDiv.style.display = 'block';
        }
    } catch (error) {
        infoDiv.innerHTML = `<span style="color: #e74c3c;">✗ Error looking up user</span>`;
        infoDiv.style.display = 'block';
    }
});

async function changeUserReferrer() {
    const newReferrerCode = document.getElementById('newReferrerCode').value.trim();
    const messageDiv = document.getElementById('editUserMessage');
    
    if (!newReferrerCode) {
        messageDiv.textContent = 'Please enter the new referrer\'s referral code';
        messageDiv.className = 'message error';
        messageDiv.style.display = 'block';
        return;
    }
    
    if (!currentUserId) {
        messageDiv.textContent = 'No user selected';
        messageDiv.className = 'message error';
        messageDiv.style.display = 'block';
        return;
    }
    
    // Confirm action
    if (!confirm('Are you sure you want to change this user\'s referrer? Any referral bonuses will be transferred to the new referrer.')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/${currentUserId}/referrer`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ new_referrer_code: newReferrerCode })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            let msg = `Referrer changed to ${data.new_referrer.full_name} (#${data.new_referrer.referral_code || 'N/A'})`;
            if (data.bonus_shifted > 0) {
                msg += `. $${data.bonus_shifted.toFixed(2)} bonus transferred.`;
            }
            messageDiv.textContent = msg;
            messageDiv.className = 'message success';
            messageDiv.style.display = 'block';
            
            // Clear input
            document.getElementById('newReferrerCode').value = '';
            document.getElementById('newReferrerInfo').style.display = 'none';
            
            // Refresh user details
            setTimeout(() => {
                viewUser(currentUserId);
                loadUsers();
            }, 1500);
        } else {
            messageDiv.textContent = data.detail || 'Failed to change referrer';
            messageDiv.className = 'message error';
            messageDiv.style.display = 'block';
        }
    } catch (error) {
        console.error('Error changing referrer:', error);
        messageDiv.textContent = 'Network error. Please try again.';
        messageDiv.className = 'message error';
        messageDiv.style.display = 'block';
    }
}

// ==================== DATE FILTER HELPERS ====================

function getDateRange(filterValue) {
    const now = new Date();
    let startDate = null;
    let endDate = new Date(now.setHours(23, 59, 59, 999));
    
    switch(filterValue) {
        case 'weekly':
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
            break;
        case 'monthly':
            startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 1);
            break;
        case 'quarterly':
            startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 3);
            break;
        case 'yearly':
            startDate = new Date();
            startDate.setFullYear(startDate.getFullYear() - 1);
            break;
        default:
            return { startDate: null, endDate: null };
    }
    
    startDate.setHours(0, 0, 0, 0);
    return { startDate, endDate };
}

// ==================== USER DATE FILTER ====================

let selectedUserIds = [];

function applyUserDateFilter() {
    const filter = document.getElementById('userDateFilter').value;
    const customRange = document.getElementById('userCustomDateRange');
    
    if (filter === 'custom') {
        customRange.style.display = 'flex';
        const customStart = document.getElementById('userStartDate').value;
        const customEnd = document.getElementById('userEndDate').value;

        if (customStart || customEnd) {
            if (allUsersData.length > 0) {
                applyUsersFiltersAndRender();
            } else {
                loadUsers();
            }
        }
    } else {
        customRange.style.display = 'none';
        if (allUsersData.length > 0) {
            applyUsersFiltersAndRender();
        } else {
            loadUsers();
        }
    }
}

// ==================== USER BULK SELECTION ====================

function toggleSelectAllUsers() {
    const selectAll = document.getElementById('selectAllUsers').checked;
    const checkboxes = document.querySelectorAll('#usersTableBody input[type="checkbox"]');
    
    selectedUserIds = [];
    checkboxes.forEach(cb => {
        cb.checked = selectAll;
        if (selectAll) {
            selectedUserIds.push(cb.value);
        }
    });
    
    updateUserBulkActions();
}

function toggleUserSelection(userId) {
    const index = selectedUserIds.indexOf(userId);
    if (index > -1) {
        selectedUserIds.splice(index, 1);
    } else {
        selectedUserIds.push(userId);
    }
    updateUserBulkActions();
}

function updateUserBulkActions() {
    const bulkActions = document.getElementById('userBulkActions');
    const countSpan = document.getElementById('selectedUsersCount');
    
    if (selectedUserIds.length > 0) {
        bulkActions.style.display = 'flex';
        countSpan.textContent = `${selectedUserIds.length} selected`;
    } else {
        bulkActions.style.display = 'none';
    }
}

function clearUserSelection() {
    selectedUserIds = [];
    document.getElementById('selectAllUsers').checked = false;
    document.querySelectorAll('#usersTableBody input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateUserBulkActions();
}

async function bulkDeactivateUsers() {
    if (selectedUserIds.length === 0) return;
    
    if (!confirm(`Are you sure you want to deactivate ${selectedUserIds.length} users?`)) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/bulk-deactivate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user_ids: selectedUserIds })
        });
        
        const data = await response.json();
        alert(data.message);
        clearUserSelection();
        loadUsers();
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to deactivate users');
    }
}

async function bulkDeleteUsers() {
    if (selectedUserIds.length === 0) return;
    
    if (!confirm(`Are you sure you want to DELETE ${selectedUserIds.length} users? This cannot be undone!`)) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/bulk-delete`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user_ids: selectedUserIds })
        });
        
        const data = await response.json();
        alert(data.message);
        clearUserSelection();
        loadUsers();
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to delete users');
    }
}

// ==================== SINGLE USER ACTIONS ====================

async function deactivateUser(userId) {
    if (!confirm('Are you sure you want to deactivate this user?')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/${userId}/deactivate`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        alert(data.message);
        loadUsers();
        loadAdminCreatedUsers();
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to deactivate user');
    }
}

async function deleteUser(userId) {
    if (!confirm('Are you sure you want to DELETE this user? This cannot be undone!')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        alert(data.message);
        loadUsers();
        loadAdminCreatedUsers();
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to delete user');
    }
}

// ==================== EXPORT TO EXCEL ====================

let currentExportType = null;

function exportToExcel(data, filename) {
    // Convert data to CSV format
    if (!data || data.length === 0) {
        alert('No data to export');
        return;
    }
    
    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(h => {
            let val = row[h];
            if (val === null || val === undefined) val = '';
            if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
                val = `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        }).join(','))
    ].join('\n');
    
    // Create download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

// Show export date modal
function showExportDateModal(exportType) {
    currentExportType = exportType;
    document.getElementById('exportDateQuickSelect').value = '';
    document.getElementById('exportCustomDateRange').style.display = 'none';
    document.getElementById('exportStartDate').value = '';
    document.getElementById('exportEndDate').value = '';
    document.getElementById('exportDateModal').style.display = 'flex';
}

function closeExportDateModal() {
    document.getElementById('exportDateModal').style.display = 'none';
    currentExportType = null;
}

function updateExportDateRange() {
    const quickSelect = document.getElementById('exportDateQuickSelect').value;
    const customRange = document.getElementById('exportCustomDateRange');
    
    if (quickSelect === 'custom') {
        customRange.style.display = 'block';
    } else {
        customRange.style.display = 'none';
    }
}

function getExportDateRange() {
    const quickSelect = document.getElementById('exportDateQuickSelect').value;
    if (!quickSelect || quickSelect === '') {
        return { startDate: null, endDate: null };
    }
    
    const now = new Date();
    let startDate = null;
    let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    
    if (quickSelect === 'weekly') {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - now.getDay());
        startDate.setHours(0, 0, 0, 0);
    } else if (quickSelect === 'monthly') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (quickSelect === 'quarterly') {
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
    } else if (quickSelect === 'yearly') {
        startDate = new Date(now.getFullYear(), 0, 1);
    } else if (quickSelect === 'custom') {
        const customStart = document.getElementById('exportStartDate').value;
        const customEnd = document.getElementById('exportEndDate').value;
        if (customStart) startDate = new Date(customStart);
        if (customEnd) {
            endDate = new Date(customEnd);
            endDate.setHours(23, 59, 59, 999);
        }
    }
    
    return { startDate, endDate };
}

function filterDataByDateRange(data, dateField, startDate, endDate) {
    if (!startDate) return data;
    
    return data.filter(item => {
        const itemDate = new Date(item[dateField]);
        return itemDate >= startDate && itemDate <= endDate;
    });
}

async function executeExport() {
    const { startDate, endDate } = getExportDateRange();
    
    switch (currentExportType) {
        case 'users':
            await doExportUsers(startDate, endDate);
            break;
        case 'withdrawals':
            await doExportWithdrawals(startDate, endDate);
            break;
        case 'admin_created':
            await doExportAdminCreatedUsers(startDate, endDate);
            break;
        case 'investments':
            await doExportInvestments(startDate, endDate);
            break;
        case 'transactions':
            await doExportTransactions(startDate, endDate);
            break;
    }
    
    closeExportDateModal();
}

// These functions now open the modal instead of exporting directly
function exportUsersToExcel() {
    showExportDateModal('users');
}

function exportWithdrawalsToExcel() {
    showExportDateModal('withdrawals');
}

async function doExportUsers(startDate, endDate) {
    try {
        const response = await fetch(`${API_URL}/api/admin/users?limit=1000`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            let users = filterNonAdminUsers(data.users || []);
            
            // Apply date filter if specified
            if (startDate) {
                users = users.filter(u => {
                    const userDate = new Date(u.created_at);
                    return userDate >= startDate && userDate <= endDate;
                });
            }
            
            const exportData = users.map(u => ({
                'Referral Code': u.referral_code || 'N/A',
                'Name': u.full_name,
                'Email': u.email,
                'Status': u.status || 'active',
                'Total Invested': u.wallet?.total_invested || 0,
                'Total Income': (u.wallet?.daily_roi || 0) + (u.wallet?.direct_income || 0) + (u.wallet?.slab_income || 0) + (u.wallet?.royalty_income || 0) + (u.wallet?.salary_income || 0),
                'Joined': new Date(u.created_at).toLocaleDateString()
            }));
            
            const dateLabel = startDate ? `_${startDate.toISOString().split('T')[0]}_to_${endDate.toISOString().split('T')[0]}` : '';
            exportToExcel(exportData, `users${dateLabel}`);
        }
    } catch (error) {
        console.error('Error exporting:', error);
        alert('Failed to export data');
    }
}

async function doExportWithdrawals(startDate, endDate) {
    try {
        const response = await fetch(`${API_URL}/api/admin/withdrawals`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            let withdrawals = data.withdrawals || [];
            
            // Apply date filter if specified
            if (startDate) {
                withdrawals = withdrawals.filter(w => {
                    const wDate = new Date(w.created_at);
                    return wDate >= startDate && wDate <= endDate;
                });
            }
            
            const exportData = withdrawals.map(w => ({
                'Referral Code': w.referral_code || 'N/A',
                'User': w.user_name || 'Unknown',
                'Email': w.user_email || '',
                'Amount': w.amount,
                'Status': w.status,
                'Payment Details': w.upi_id ? `UPI: ${w.upi_id}` : (w.bank_details || 'N/A'),
                'Request Date': new Date(w.created_at).toLocaleDateString()
            }));
            
            const dateLabel = startDate ? `_${startDate.toISOString().split('T')[0]}_to_${endDate.toISOString().split('T')[0]}` : '';
            exportToExcel(exportData, `withdrawals${dateLabel}`);
        }
    } catch (error) {
        console.error('Error exporting:', error);
        alert('Failed to export data');
    }
}

async function exportAdminCreatedUsersToExcel() {
    showExportDateModal('admin_created');
}

async function doExportAdminCreatedUsers(startDate, endDate) {
    try {
        const response = await fetch(`${API_URL}/api/admin/users/created-by-admin`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            let users = data.users || [];
            
            // Apply date filter if specified
            if (startDate) {
                users = users.filter(u => {
                    const userDate = new Date(u.created_at);
                    return userDate >= startDate && userDate <= endDate;
                });
            }
            
            const exportData = users.map(u => ({
                'Referral Code': u.referral_code || 'N/A',
                'Name': u.full_name,
                'Email': u.email,
                'Status': u.status,
                'Total Invested': u.total_invested,
                'Created By': 'Admin',
                'Created At': new Date(u.created_at).toLocaleDateString()
            }));
            
            const dateLabel = startDate ? `_${startDate.toISOString().split('T')[0]}_to_${endDate.toISOString().split('T')[0]}` : '';
            exportToExcel(exportData, `admin_created_users${dateLabel}`);
        }
    } catch (error) {
        console.error('Error exporting:', error);
        alert('Failed to export data');
    }
}

// ==================== ADMIN CREATED USERS ENHANCEMENTS ====================

let selectedAdminCreatedIds = [];

function applyAdminCreatedDateFilter() {
    const filter = document.getElementById('adminCreatedDateFilter').value;
    const customRange = document.getElementById('adminCreatedCustomDateRange');
    
    if (filter === 'custom') {
        customRange.style.display = 'flex';
        // Don't reload, wait for user to click Apply
    } else {
        customRange.style.display = 'none';
        // Re-filter the existing data
        if (allAdminCreatedUsersData.length > 0) {
            const filteredUsers = filterAdminCreatedUsersByDate(allAdminCreatedUsersData);
            renderAdminCreatedUsersTable(filteredUsers);
        } else {
            loadAdminCreatedUsers();
        }
    }
}

function toggleSelectAllAdminCreated() {
    const selectAll = document.getElementById('selectAllAdminCreated').checked;
    const checkboxes = document.querySelectorAll('#adminCreatedUsersTable input[type="checkbox"]');
    
    selectedAdminCreatedIds = [];
    checkboxes.forEach(cb => {
        cb.checked = selectAll;
        if (selectAll) {
            selectedAdminCreatedIds.push(cb.value);
        }
    });
    
    updateAdminCreatedBulkActions();
}

function toggleAdminCreatedSelection(userId) {
    const index = selectedAdminCreatedIds.indexOf(userId);
    if (index > -1) {
        selectedAdminCreatedIds.splice(index, 1);
    } else {
        selectedAdminCreatedIds.push(userId);
    }
    updateAdminCreatedBulkActions();
}

function updateAdminCreatedBulkActions() {
    const bulkActions = document.getElementById('adminCreatedBulkActions');
    const countSpan = document.getElementById('selectedAdminCreatedCount');
    
    if (selectedAdminCreatedIds.length > 0) {
        bulkActions.style.display = 'flex';
        countSpan.textContent = `${selectedAdminCreatedIds.length} selected`;
    } else {
        bulkActions.style.display = 'none';
    }
}

function clearAdminCreatedSelection() {
    selectedAdminCreatedIds = [];
    document.getElementById('selectAllAdminCreated').checked = false;
    document.querySelectorAll('#adminCreatedUsersTable input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateAdminCreatedBulkActions();
}

async function bulkDeactivateAdminCreatedUsers() {
    if (selectedAdminCreatedIds.length === 0) return;
    
    if (!confirm(`Are you sure you want to deactivate ${selectedAdminCreatedIds.length} users?`)) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/bulk-deactivate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user_ids: selectedAdminCreatedIds })
        });
        
        const data = await response.json();
        alert(data.message);
        clearAdminCreatedSelection();
        loadAdminCreatedUsers();
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to deactivate users');
    }
}

async function bulkDeleteAdminCreatedUsers() {
    if (selectedAdminCreatedIds.length === 0) return;
    
    if (!confirm(`Are you sure you want to DELETE ${selectedAdminCreatedIds.length} users? This cannot be undone!`)) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/bulk-delete`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user_ids: selectedAdminCreatedIds })
        });
        
        const data = await response.json();
        alert(data.message);
        clearAdminCreatedSelection();
        loadAdminCreatedUsers();
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to delete users');
    }
}

// ==================== WITHDRAWAL DATE FILTER ====================

function applyWithdrawalDateFilter() {
    const filter = document.getElementById('withdrawalDateFilter').value;
    const customRange = document.getElementById('withdrawalCustomDateRange');
    
    if (filter === 'custom') {
        customRange.style.display = 'flex';
        // Don't reload, wait for user to click Apply with dates
    } else {
        customRange.style.display = 'none';
        // Re-filter the existing data
        if (allWithdrawalsData.length > 0) {
            const filteredWithdrawals = filterWithdrawalsByDate(allWithdrawalsData);
            const summary = calculateWithdrawalsSummary(filteredWithdrawals);
            document.getElementById('pendingCount').textContent = summary.total_pending;
            document.getElementById('pendingAmount').textContent = summary.pending_amount.toFixed(2);
            document.getElementById('approvedCount').textContent = summary.total_approved;
            document.getElementById('approvedAmount').textContent = summary.approved_amount.toFixed(2);
            document.getElementById('cancelledCount').textContent = summary.total_cancelled;
            document.getElementById('cancelledAmount').textContent = summary.cancelled_amount.toFixed(2);
            document.getElementById('totalWithdrawnAmount').textContent = `$${summary.total_withdrawn.toFixed(2)}`;
            renderWithdrawalsTable(filteredWithdrawals);
        } else {
            loadWithdrawals();
        }
    }
}


// ==================== ADMIN FAQ TOGGLE ====================
function toggleAdminFaq(element) {
    // Close all other FAQs in the same category
    const category = element.closest('.faq-category');
    const allFaqs = category.querySelectorAll('.admin-faq-item');
    
    allFaqs.forEach(faq => {
        if (faq !== element) {
            faq.classList.remove('active');
        }
    });
    
    // Toggle current FAQ
    element.classList.toggle('active');
}


// ==================== ADMIN TICKET MANAGEMENT ====================

async function loadAdminTickets() {
    const tbody = document.getElementById('adminTicketsTable');
    tbody.innerHTML = '<tr><td colspan="8" class="loading">Loading tickets...</td></tr>';
    
    const statusFilter = document.getElementById('ticketStatusFilter').value;
    let url = `${API_URL}/api/admin/tickets`;
    if (statusFilter) {
        url += `?status=${statusFilter}`;
    }
    
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // Update summary
            if (data.summary) {
                document.getElementById('openTicketsCount').textContent = data.summary.open || 0;
                document.getElementById('inProgressTicketsCount').textContent = data.summary.in_progress || 0;
                document.getElementById('resolvedTicketsCount').textContent = data.summary.resolved || 0;
                document.getElementById('closedTicketsCount').textContent = data.summary.closed || 0;
            }
            
            // Render table
            renderAdminTicketsTable(data.tickets || []);
        }
    } catch (error) {
        console.error('Error loading tickets:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="loading">Error loading tickets</td></tr>';
    }
}

function renderAdminTicketsTable(tickets) {
    const tbody = document.getElementById('adminTicketsTable');
    
    if (!tickets || tickets.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading">No tickets found</td></tr>';
        return;
    }
    
    const statusColors = {
        'open': '#27ae60',
        'in_progress': '#f39c12',
        'resolved': '#3498db',
        'closed': '#7f8c8d'
    };
    
    tbody.innerHTML = tickets.map(ticket => `
        <tr>
            <td><strong>${ticket.ticket_number}</strong></td>
            <td>
                <strong>#${ticket.user_referral_code || 'N/A'}</strong><br>
                <small>${ticket.user_email}</small>
            </td>
            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${ticket.subject}</td>
            <td><span style="text-transform: capitalize;">${ticket.category}</span></td>
            <td><span class="priority-badge ${ticket.priority}">${ticket.priority}</span></td>
            <td><span class="type-badge" style="background: ${statusColors[ticket.status]}">${ticket.status.replace('_', ' ')}</span></td>
            <td>${new Date(ticket.created_at).toLocaleDateString()}</td>
            <td>
                <button class="btn btn-info btn-sm" onclick="viewAdminTicket('${ticket.id}')">View</button>
                <button class="btn btn-danger btn-sm" onclick="deleteTicket('${ticket.id}')">Del</button>
            </td>
        </tr>
    `).join('');
}

async function viewAdminTicket(ticketId) {
    try {
        const response = await fetch(`${API_URL}/api/admin/tickets/${ticketId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const ticket = await response.json();
            showAdminTicketModal(ticket);
        } else {
            alert('Error loading ticket details');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error loading ticket details');
    }
}

function showAdminTicketModal(ticket) {
    const container = document.getElementById('adminTicketContent');
    
    const messagesHtml = ticket.messages.map(msg => `
        <div class="admin-message ${msg.sender === 'admin' ? 'admin-msg' : 'user-msg'}">
            <div class="msg-header">
                <span class="msg-sender">${msg.sender === 'admin' ? '👨‍💼 Admin' : '👤 ' + msg.sender_name}</span>
                <span class="msg-time">${new Date(msg.timestamp).toLocaleString()}</span>
            </div>
            <div class="msg-text">${msg.message}</div>
        </div>
    `).join('');
    
    container.innerHTML = `
        <div class="admin-ticket-detail">
            <div class="admin-ticket-header">
                <div>
                    <h3>${ticket.ticket_number} - ${ticket.subject}</h3>
                    <div class="admin-ticket-meta">
                        <span>👤 ${ticket.user_name} (#${ticket.user_referral_code || 'N/A'})</span>
                        <span>📧 ${ticket.user_email}</span>
                        <span>📁 ${ticket.category}</span>
                        <span>⚡ ${ticket.priority}</span>
                    </div>
                </div>
                <div class="ticket-status-actions">
                    <select id="ticketStatusSelect" onchange="updateTicketStatus('${ticket.id}')">
                        <option value="open" ${ticket.status === 'open' ? 'selected' : ''}>Open</option>
                        <option value="in_progress" ${ticket.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                        <option value="resolved" ${ticket.status === 'resolved' ? 'selected' : ''}>Resolved</option>
                        <option value="closed" ${ticket.status === 'closed' ? 'selected' : ''}>Closed</option>
                    </select>
                </div>
            </div>
            
            <div class="admin-messages-container">
                ${messagesHtml}
            </div>
            
            ${ticket.status !== 'closed' ? `
                <div class="admin-reply-form">
                    <textarea id="adminReplyMessage" placeholder="Type your reply to the user..."></textarea>
                    <div class="form-actions">
                        <button class="btn btn-primary" onclick="adminReplyTicket('${ticket.id}')">Send Reply</button>
                        <button class="btn btn-success" onclick="resolveTicket('${ticket.id}')">Mark Resolved</button>
                        <button class="btn btn-secondary" onclick="closeTicket('${ticket.id}')">Close Ticket</button>
                    </div>
                </div>
            ` : '<p style="text-align: center; color: var(--text-secondary);">This ticket is closed</p>'}
        </div>
    `;
    
    document.getElementById('adminTicketModal').style.display = 'flex';
}

function closeAdminTicketModal() {
    document.getElementById('adminTicketModal').style.display = 'none';
}

async function adminReplyTicket(ticketId) {
    const message = document.getElementById('adminReplyMessage').value.trim();
    
    if (!message) {
        alert('Please enter a reply message');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/tickets/${ticketId}/reply`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ message })
        });
        
        if (response.ok) {
            closeAdminTicketModal();
            viewAdminTicket(ticketId);
            loadAdminTickets();
        } else {
            const data = await response.json();
            alert(data.detail || 'Failed to send reply');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error sending reply');
    }
}

async function updateTicketStatus(ticketId) {
    const status = document.getElementById('ticketStatusSelect').value;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/tickets/${ticketId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ status })
        });
        
        if (response.ok) {
            loadAdminTickets();
        } else {
            const data = await response.json();
            alert(data.detail || 'Failed to update status');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error updating status');
    }
}

async function resolveTicket(ticketId) {
    if (!confirm('Mark this ticket as resolved?')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/tickets/${ticketId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ status: 'resolved' })
        });
        
        if (response.ok) {
            closeAdminTicketModal();
            loadAdminTickets();
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error updating status');
    }
}

async function closeTicket(ticketId) {
    if (!confirm('Close this ticket? Users will not be able to reply.')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/tickets/${ticketId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ status: 'closed' })
        });
        
        if (response.ok) {
            closeAdminTicketModal();
            loadAdminTickets();
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error closing ticket');
    }
}

async function deleteTicket(ticketId) {
    if (!confirm('Are you sure you want to delete this ticket? This cannot be undone.')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/tickets/${ticketId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            loadAdminTickets();
        } else {
            const data = await response.json();
            alert(data.detail || 'Failed to delete ticket');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error deleting ticket');
    }
}


// ==================== LEARNING CENTER MANAGEMENT ====================

async function loadLearningVideos() {
    const grid = document.getElementById('adminVideosGrid');
    grid.innerHTML = '<div class="loading">Loading videos...</div>';
    
    try {
        const response = await fetch(`${API_URL}/api/admin/learning/videos`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // Update stats
            if (data.summary) {
                document.getElementById('totalVideosCount').textContent = data.summary.total || 0;
                document.getElementById('activeVideosCount').textContent = data.summary.active || 0;
            }
            
            renderVideosGrid(data.videos || []);
        }
    } catch (error) {
        console.error('Error loading videos:', error);
        grid.innerHTML = '<div class="loading">Error loading videos</div>';
    }
}

function renderVideosGrid(videos) {
    const grid = document.getElementById('adminVideosGrid');
    
    if (!videos || videos.length === 0) {
        grid.innerHTML = `
            <div class="no-videos">
                <div class="no-videos-icon">🎬</div>
                <h3>No Videos Yet</h3>
                <p>Add your first YouTube video to the Learning Center</p>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = videos.map(video => `
        <div class="video-card ${video.is_active ? '' : 'inactive'}">
            <div class="video-thumbnail">
                <img src="${video.thumbnail_url}" alt="${video.title}" onerror="this.src='https://via.placeholder.com/320x180?text=Video'">
                <div class="video-play-icon">▶</div>
            </div>
            <div class="video-info">
                <div class="video-title">${video.title}</div>
                <div class="video-meta">
                    <span class="video-category">${video.category.replace('_', ' ')}</span>
                    <span class="video-status ${video.is_active ? 'active' : 'inactive'}">${video.is_active ? 'Active' : 'Inactive'}</span>
                </div>
                <div class="video-actions">
                    <button class="btn btn-info btn-sm" onclick="editVideo('${video.id}')">Edit</button>
                    <button class="btn btn-${video.is_active ? 'warning' : 'success'} btn-sm" onclick="toggleVideoStatus('${video.id}', ${!video.is_active})">${video.is_active ? 'Disable' : 'Enable'}</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteVideo('${video.id}')">Delete</button>
                </div>
            </div>
        </div>
    `).join('');
}

function showAddVideoModal() {
    document.getElementById('videoModalTitle').textContent = 'Add New Video';
    document.getElementById('editVideoId').value = '';
    document.getElementById('videoForm').reset();
    document.getElementById('videoActive').checked = true;
    document.getElementById('videoModal').style.display = 'flex';
}

function closeVideoModal() {
    document.getElementById('videoModal').style.display = 'none';
}

async function editVideo(videoId) {
    try {
        const response = await fetch(`${API_URL}/api/admin/learning/videos`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            const video = data.videos.find(v => v.id === videoId);
            
            if (video) {
                document.getElementById('videoModalTitle').textContent = 'Edit Video';
                document.getElementById('editVideoId').value = video.id;
                document.getElementById('videoTitle').value = video.title;
                document.getElementById('videoUrl').value = video.youtube_url;
                document.getElementById('videoDescription').value = video.description || '';
                document.getElementById('videoCategory').value = video.category;
                document.getElementById('videoOrder').value = video.display_order || 0;
                document.getElementById('videoActive').checked = video.is_active;
                document.getElementById('videoModal').style.display = 'flex';
            }
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error loading video details');
    }
}

async function saveVideo(event) {
    event.preventDefault();
    
    const videoId = document.getElementById('editVideoId').value;
    const videoData = {
        title: document.getElementById('videoTitle').value,
        youtube_url: document.getElementById('videoUrl').value,
        description: document.getElementById('videoDescription').value,
        category: document.getElementById('videoCategory').value,
        display_order: parseInt(document.getElementById('videoOrder').value) || 0,
        is_active: document.getElementById('videoActive').checked
    };
    
    try {
        const url = videoId 
            ? `${API_URL}/api/admin/learning/videos/${videoId}`
            : `${API_URL}/api/admin/learning/videos`;
        
        const response = await fetch(url, {
            method: videoId ? 'PUT' : 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(videoData)
        });
        
        if (response.ok) {
            closeVideoModal();
            loadLearningVideos();
            alert(videoId ? 'Video updated successfully!' : 'Video added successfully!');
        } else {
            const data = await response.json();
            alert(data.detail || 'Failed to save video');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error saving video');
    }
}

async function toggleVideoStatus(videoId, newStatus) {
    try {
        const response = await fetch(`${API_URL}/api/admin/learning/videos/${videoId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ is_active: newStatus })
        });
        
        if (response.ok) {
            loadLearningVideos();
        } else {
            const data = await response.json();
            alert(data.detail || 'Failed to update status');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error updating status');
    }
}

async function deleteVideo(videoId) {
    if (!confirm('Are you sure you want to delete this video?')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/learning/videos/${videoId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            loadLearningVideos();
        } else {
            const data = await response.json();
            alert(data.detail || 'Failed to delete video');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error deleting video');
    }
}

// ==================== INVESTMENT PLANS MANAGEMENT ====================

async function loadInvestmentPlans() {
    try {
        const response = await fetch(`${API_URL}/api/admin/investment-plans`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const plans = await response.json();
            renderPlans(plans);
            
            // Update stats
            document.getElementById('totalPlansCount').textContent = plans.length;
            document.getElementById('activePlansCount').textContent = plans.filter(p => p.is_active).length;
        } else {
            document.getElementById('plansGrid').innerHTML = '<p class="empty-state">Failed to load plans</p>';
        }
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('plansGrid').innerHTML = '<p class="empty-state">Error loading plans</p>';
    }
}

function renderPlans(plans) {
    const grid = document.getElementById('plansGrid');
    
    if (plans.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <p>No investment plans created yet.</p>
                <button class="btn btn-primary" onclick="showAddPlanModal()">Create First Plan</button>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = plans.map(plan => {
        return `
        <div class="plan-card ${plan.is_active ? '' : 'inactive'}">
            <div class="plan-header">
                <h3>${plan.name}</h3>
                <span class="plan-status ${plan.is_active ? 'active' : 'inactive'}">
                    ${plan.is_active ? 'Active' : 'Inactive'}
                </span>
            </div>
            <div class="plan-details">
                <div class="plan-stat">
                    <span class="stat-label">Daily ROI</span>
                    <span class="stat-value">${plan.daily_roi}%</span>
                </div>
                <div class="plan-stat">
                    <span class="stat-label">Total Return</span>
                    <span class="stat-value">${plan.total_return || 2}x</span>
                </div>
                <div class="plan-stat">
                    <span class="stat-label">Direct Income</span>
                    <span class="stat-value">${plan.direct_income || 5}%</span>
                </div>
                <div class="plan-stat">
                    <span class="stat-label">Level Income</span>
                    <span class="stat-value">5-45% (Fixed Slabs)</span>
                </div>
                <div class="plan-stat">
                    <span class="stat-label">Validity</span>
                    <span class="stat-value">${plan.validity_days} Days</span>
                </div>
                <div class="plan-stat">
                    <span class="stat-label">Min Investment</span>
                    <span class="stat-value">$${plan.min_investment}</span>
                </div>
            </div>
            ${plan.description ? `<p class="plan-description">${plan.description}</p>` : ''}
            <div class="plan-actions">
                <button class="btn btn-small btn-primary" onclick="editPlan('${plan.id}')">Edit</button>
                <button class="btn btn-small ${plan.is_active ? 'btn-warning' : 'btn-success'}" 
                    onclick="togglePlanStatus('${plan.id}', ${!plan.is_active})">
                    ${plan.is_active ? 'Disable' : 'Enable'}
                </button>
                <button class="btn btn-small btn-danger" onclick="deletePlan('${plan.id}')">Delete</button>
            </div>
        </div>
    `}).join('');
}

function showAddPlanModal() {
    document.getElementById('planModalTitle').textContent = 'Add New Investment Plan';
    document.getElementById('editPlanId').value = '';
    document.getElementById('planForm').reset();
    document.getElementById('planActive').checked = true;
    document.getElementById('planValidityDays').value = 100;
    document.getElementById('planMinInvestment').value = 20;
    document.getElementById('planTotalReturn').value = 2;
    document.getElementById('planDirectIncome').value = 5;
    document.getElementById('planModal').style.display = 'flex';
}

function closePlanModal() {
    document.getElementById('planModal').style.display = 'none';
}

async function editPlan(planId) {
    try {
        const response = await fetch(`${API_URL}/api/admin/investment-plans`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const plans = await response.json();
            const plan = plans.find(p => p.id === planId);
            
            if (plan) {
                document.getElementById('planModalTitle').textContent = 'Edit Investment Plan';
                document.getElementById('editPlanId').value = plan.id;
                document.getElementById('planName').value = plan.name;
                document.getElementById('planDailyRoi').value = plan.daily_roi;
                document.getElementById('planTotalReturn').value = plan.total_return || 2;
                document.getElementById('planDirectIncome').value = plan.direct_income || 5;
                document.getElementById('planValidityDays').value = plan.validity_days;
                document.getElementById('planMinInvestment').value = plan.min_investment;
                document.getElementById('planMaxInvestment').value = plan.max_investment || '';
                document.getElementById('planDescription').value = plan.description || '';
                document.getElementById('planActive').checked = plan.is_active;
                document.getElementById('planModal').style.display = 'flex';
            }
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error loading plan details');
    }
}

async function savePlan(event) {
    event.preventDefault();
    
    const planId = document.getElementById('editPlanId').value;
    
    const planData = {
        name: document.getElementById('planName').value,
        daily_roi: parseFloat(document.getElementById('planDailyRoi').value),
        total_return: parseFloat(document.getElementById('planTotalReturn').value),
        direct_income: parseFloat(document.getElementById('planDirectIncome').value),
        validity_days: parseInt(document.getElementById('planValidityDays').value),
        min_investment: parseFloat(document.getElementById('planMinInvestment').value),
        max_investment: document.getElementById('planMaxInvestment').value ? 
            parseFloat(document.getElementById('planMaxInvestment').value) : null,
        description: document.getElementById('planDescription').value,
        is_active: document.getElementById('planActive').checked
    };
    
    try {
        const url = planId 
            ? `${API_URL}/api/admin/investment-plans/${planId}`
            : `${API_URL}/api/admin/investment-plans`;
        
        const response = await fetch(url, {
            method: planId ? 'PUT' : 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(planData)
        });
        
        if (response.ok) {
            closePlanModal();
            loadInvestmentPlans();
            alert(planId ? 'Plan updated successfully!' : 'Plan created successfully!');
        } else {
            const data = await response.json();
            alert(data.detail || 'Failed to save plan');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error saving plan');
    }
}

async function togglePlanStatus(planId, newStatus) {
    try {
        const response = await fetch(`${API_URL}/api/admin/investment-plans/${planId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ is_active: newStatus })
        });
        
        if (response.ok) {
            loadInvestmentPlans();
        } else {
            const data = await response.json();
            alert(data.detail || 'Failed to update plan status');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error updating plan status');
    }
}

async function deletePlan(planId) {
    if (!confirm('Are you sure you want to delete this plan? This cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/investment-plans/${planId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            loadInvestmentPlans();
            alert('Plan deleted successfully!');
        } else {
            const data = await response.json();
            alert(data.detail || 'Failed to delete plan');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error deleting plan');
    }
}

// ==================== ADMIN INVESTMENT FUNCTIONS ====================

let selectedUserForInvestment = null;

async function showAddInvestmentModal() {
    // Get the current selected user from user details modal
    if (!selectedUserForInvestment) {
        alert('Please select a user first');
        return;
    }
    
    document.getElementById('investmentUserId').value = selectedUserForInvestment.id;
    document.getElementById('investmentUserName').textContent = selectedUserForInvestment.full_name;
    document.getElementById('investmentUserEmail').textContent = selectedUserForInvestment.email;
    document.getElementById('adminInvestmentAmount').value = '';
    document.getElementById('adminInvestmentMessage').textContent = '';
    document.getElementById('adminInvestmentMessage').className = 'message';
    
    // Load investment plans
    await loadInvestmentPlansForAdmin();
    
    document.getElementById('addInvestmentModal').style.display = 'flex';
}

function closeAddInvestmentModal() {
    document.getElementById('addInvestmentModal').style.display = 'none';
}

async function loadInvestmentPlansForAdmin() {
    try {
        const response = await fetch(`${API_URL}/api/investment-plans`);
        
        if (response.ok) {
            const plans = await response.json();
            const select = document.getElementById('adminInvestmentPlan');
            
            if (plans.length > 0) {
                select.innerHTML = plans.map(plan => 
                    `<option value="${plan.id}">${plan.name} (${plan.daily_roi}% Daily ROI - ${plan.total_return || 2}x Return)</option>`
                ).join('');
            } else {
                select.innerHTML = `
                    <option value="premium">Premium Plan (1% Daily ROI - 2x Return)</option>
                    <option value="regular">Regular Plan (0.5% Daily ROI - 1.5x Return)</option>
                `;
            }
        } else {
            document.getElementById('adminInvestmentPlan').innerHTML = `
                <option value="premium">Premium Plan (1% Daily ROI)</option>
                <option value="regular">Regular Plan (0.5% Daily ROI)</option>
            `;
        }
    } catch (error) {
        console.error('Error loading plans:', error);
        document.getElementById('adminInvestmentPlan').innerHTML = `
            <option value="premium">Premium Plan (1% Daily ROI)</option>
        `;
    }
}

async function createAdminInvestment() {
    const userId = document.getElementById('investmentUserId').value;
    const planId = document.getElementById('adminInvestmentPlan').value;
    const amount = parseFloat(document.getElementById('adminInvestmentAmount').value);
    const messageDiv = document.getElementById('adminInvestmentMessage');
    
    if (!planId) {
        messageDiv.textContent = 'Please select an investment plan';
        messageDiv.className = 'message error';
        return;
    }
    
    if (!amount || amount < 20) {
        messageDiv.textContent = 'Minimum investment amount is $20';
        messageDiv.className = 'message error';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/investments/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                user_id: userId,
                amount: amount,
                plan_id: planId
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            messageDiv.innerHTML = `
                <strong>Investment created successfully!</strong><br>
                Amount: $${amount}<br>
                Direct Income distributed: $${data.income_distributed?.direct_income?.toFixed(2) || '0.00'}<br>
                <small style="color: #999;">${data.income_distributed?.note || 'Level income will be distributed when team earns ROI'}</small>
            `;
            messageDiv.className = 'message success';
            
            // Refresh the user's transaction history
            setTimeout(() => {
                closeAddInvestmentModal();
                loadUserTransactionHistory(userId);
            }, 2000);
        } else {
            messageDiv.textContent = data.detail || 'Failed to create investment';
            messageDiv.className = 'message error';
        }
    } catch (error) {
        console.error('Error:', error);
        messageDiv.textContent = 'Network error. Please try again.';
        messageDiv.className = 'message error';
    }
}
