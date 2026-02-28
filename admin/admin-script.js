// API Base URL
const API_URL = window.location.origin;
let authToken = localStorage.getItem('admin_token');
let currentUserId = null;
let allTransactions = [];

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
                'cryptoWithdrawals': 'Crypto Withdrawals (USDT TRC20)',
                'withdrawals': 'Withdrawal Requests',
                'investments': 'Investments',
                'roiLogs': 'ROI Distribution Logs',
                'transactions': 'Transactions',
                'income': 'Income Calculator',
                'settings': 'Platform Settings'
            };
            document.getElementById('pageTitle').textContent = titles[page];
            
            loadPageData(page);
        }
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
        case 'cryptoWithdrawals':
            loadCryptoWithdrawals();
            break;
        case 'withdrawals':
            loadWithdrawals();
            break;
        case 'investments':
            loadInvestments();
            break;
        case 'roiLogs':
            loadROILogs();
            break;
        case 'transactions':
            loadTransactions();
            break;
        case 'income':
            loadUsersForSalary();
            break;
        case 'settings':
            loadSettings();
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

async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '<tr><td colspan="9" class="loading">Loading users...</td></tr>';
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users?limit=100`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" class="loading">No users found</td></tr>';
                return;
            }
            
            tbody.innerHTML = '';
            data.users.forEach(user => {
                const wallet = user.wallet || {};
                const totalIncome = (wallet.daily_roi || 0) + (wallet.direct_income || 0) + 
                                   (wallet.slab_income || 0) + (wallet.royalty_income || 0) + 
                                   (wallet.salary_income || 0);
                
                const statusClass = user.status === 'active' ? 'status-active' : 'status-inactive';
                const statusText = user.status === 'active' ? 'Active' : 'Inactive';
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><strong>#${user.user_number || 'N/A'}</strong></td>
                    <td>${user.full_name}</td>
                    <td>${user.email}</td>
                    <td><code>${user.referral_code}</code></td>
                    <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                    <td>$${(wallet.total_invested || 0).toFixed(2)}</td>
                    <td>$${totalIncome.toFixed(2)}</td>
                    <td>${new Date(user.created_at).toLocaleDateString()}</td>
                    <td>
                        <button class="action-btn btn-view" onclick="viewUser('${user.id}')">Manage</button>
                        ${!user.is_admin ? `
                            <button class="action-btn ${user.status === 'active' ? 'btn-warning' : 'btn-success'}" onclick="toggleUserStatus('${user.id}')">${user.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                            <button class="action-btn btn-delete" onclick="deleteUser('${user.id}')">Delete</button>
                        ` : ''}
                    </td>
                `;
                tbody.appendChild(row);
            });
        }
    } catch (error) {
        console.error('Error loading users:', error);
        tbody.innerHTML = '<tr><td colspan="9" class="loading">Error loading users</td></tr>';
    }
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
            
            document.getElementById('modalUserName').textContent = user.full_name;
            
            const content = `
                <div class="user-details">
                    <div class="detail-row">
                        <span class="detail-label">User ID:</span>
                        <span class="detail-value"><strong>#${user.user_number || 'N/A'}</strong></span>
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
                        <span class="detail-label">Status:</span>
                        <span class="detail-value"><span class="status-badge ${user.status === 'active' ? 'status-active' : 'status-inactive'}">${user.status || 'active'}</span></span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Total Invested:</span>
                        <span class="detail-value">$${(wallet.total_invested || 0).toFixed(2)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Total Withdrawn:</span>
                        <span class="detail-value">$${(wallet.total_withdrawn || 0).toFixed(2)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Referrals:</span>
                        <span class="detail-value">${data.referrals?.length || 0}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Joined:</span>
                        <span class="detail-value">${new Date(user.created_at).toLocaleString()}</span>
                    </div>
                </div>
            `;
            
            document.getElementById('modalUserContent').innerHTML = content;
            
            const walletGrid = document.getElementById('walletGrid');
            walletGrid.innerHTML = `
                <div class="wallet-card">
                    <div class="wallet-title">📈 Daily ROI</div>
                    <div class="wallet-amount">$${(wallet.daily_roi || 0).toFixed(2)}</div>
                </div>
                <div class="wallet-card">
                    <div class="wallet-title">🎁 Direct Income</div>
                    <div class="wallet-amount">$${(wallet.direct_income || 0).toFixed(2)}</div>
                </div>
                <div class="wallet-card">
                    <div class="wallet-title">📊 Slab Income</div>
                    <div class="wallet-amount">$${(wallet.slab_income || 0).toFixed(2)}</div>
                </div>
                <div class="wallet-card">
                    <div class="wallet-title">👑 Royalty Income</div>
                    <div class="wallet-amount">$${(wallet.royalty_income || 0).toFixed(2)}</div>
                </div>
                <div class="wallet-card">
                    <div class="wallet-title">💼 Salary Income</div>
                    <div class="wallet-amount">$${(wallet.salary_income || 0).toFixed(2)}</div>
                </div>
            `;
            
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
}

// ==================== WITHDRAWALS MANAGEMENT ====================

async function loadWithdrawals() {
    const tbody = document.getElementById('withdrawalsTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Loading withdrawals...</td></tr>';
    
    const filter = document.getElementById('withdrawalFilter').value;
    let url = `${API_URL}/api/admin/withdrawals`;
    if (filter) {
        url += `?status=${filter}`;
    }
    
    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // Update summary
            document.getElementById('pendingCount').textContent = data.summary.total_pending;
            document.getElementById('pendingAmount').textContent = (data.summary.pending_amount || 0).toFixed(2);
            document.getElementById('approvedCount').textContent = data.summary.total_approved;
            document.getElementById('approvedAmount').textContent = (data.summary.approved_amount || 0).toFixed(2);
            document.getElementById('cancelledCount').textContent = data.summary.total_cancelled;
            document.getElementById('cancelledAmount').textContent = (data.summary.cancelled_amount || 0).toFixed(2);
            document.getElementById('totalWithdrawnAmount').textContent = `$${(data.summary.total_withdrawn || 0).toFixed(2)}`;
            
            if (!data.withdrawals || data.withdrawals.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="loading">No withdrawal requests found</td></tr>';
                return;
            }
            
            tbody.innerHTML = '';
            data.withdrawals.forEach(w => {
                const statusColors = {
                    'pending': '#f39c12',
                    'approved': '#27ae60',
                    'cancelled': '#e74c3c'
                };
                
                const paymentDetails = w.upi_id ? `UPI: ${w.upi_id}` : (w.bank_details || 'N/A');
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><strong>#${w.user_number || 'N/A'}</strong></td>
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
    } catch (error) {
        console.error('Error loading withdrawals:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="loading">Error loading withdrawals</td></tr>';
    }
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
                        <strong>#${user.user_number || 'N/A'}</strong><br>
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
                    select.innerHTML += `<option value="${user.id}">#${user.user_number || 'N/A'} - ${user.full_name} (${user.email})</option>`;
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

async function loadInvestments() {
    const tbody = document.getElementById('investmentsTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Loading investments...</td></tr>';
    
    try {
        const response = await fetch(`${API_URL}/api/admin/investments?limit=100`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            if (!data.investments || data.investments.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="loading">No investments found</td></tr>';
                return;
            }
            
            tbody.innerHTML = '';
            data.investments.forEach(investment => {
                const slabRate = getSlabRate(investment.amount);
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><strong>#${investment.user_number || 'N/A'}</strong></td>
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
    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="loading">Error loading investments</td></tr>';
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

async function loadTransactions() {
    const tbody = document.getElementById('transactionsTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading transactions...</td></tr>';
    
    try {
        const response = await fetch(`${API_URL}/api/admin/transactions?limit=200`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            allTransactions = data.transactions || [];
            renderTransactions(allTransactions);
        }
    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="loading">Error loading transactions</td></tr>';
    }
}

function renderTransactions(transactions) {
    const tbody = document.getElementById('transactionsTableBody');
    
    if (!transactions || transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading">No transactions found</td></tr>';
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
        const row = document.createElement('tr');
        row.innerHTML = `
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
    const filter = document.getElementById('transactionFilter').value;
    
    if (filter === 'all') {
        renderTransactions(allTransactions);
    } else {
        const filtered = allTransactions.filter(t => t.type === filter);
        renderTransactions(filtered);
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
document.getElementById('userSearch')?.addEventListener('input', function(e) {
    const searchTerm = e.target.value.toLowerCase();
    const rows = document.querySelectorAll('#usersTableBody tr');
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
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
                        <strong>#${transfer.sender_user_number}</strong><br>
                        <small>${transfer.sender_name}</small>
                    </td>
                    <td>
                        <strong>#${transfer.recipient_user_number}</strong><br>
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
    const senderUserNumber = document.getElementById('p2pSenderUserId').value;
    const recipientUserNumber = document.getElementById('p2pRecipientUserId').value;
    const amount = parseFloat(document.getElementById('p2pAmount').value);
    const description = document.getElementById('p2pDescription').value;
    const resultDiv = document.getElementById('p2pResult');
    
    // Validation
    if (!senderUserNumber || !recipientUserNumber) {
        showP2PResult('Please enter both Sender and Recipient User IDs', 'error');
        return;
    }
    
    if (!amount || amount <= 0) {
        showP2PResult('Please enter a valid amount', 'error');
        return;
    }
    
    if (senderUserNumber === recipientUserNumber) {
        showP2PResult('Sender and Recipient cannot be the same', 'error');
        return;
    }
    
    if (!confirm(`Are you sure you want to transfer $${amount.toFixed(2)} from User #${senderUserNumber} to User #${recipientUserNumber}?`)) {
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
                sender_user_number: parseInt(senderUserNumber),
                recipient_user_number: parseInt(recipientUserNumber),
                amount: amount,
                description: description
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showP2PResult(
                `Transfer Successful! $${amount.toFixed(2)} transferred from ${data.sender.name} (#${data.sender.user_number}) to ${data.recipient.name} (#${data.recipient.user_number})`,
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

// User ID lookup on input change
document.getElementById('p2pSenderUserId')?.addEventListener('blur', async function() {
    const userNumber = this.value;
    const infoDiv = document.getElementById('senderInfo');
    
    if (!userNumber) {
        infoDiv.style.display = 'none';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users?limit=100`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            const user = data.users.find(u => u.user_number == userNumber);
            
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
    const userNumber = this.value;
    const infoDiv = document.getElementById('recipientInfo');
    
    if (!userNumber) {
        infoDiv.style.display = 'none';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users?limit=100`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            const user = data.users.find(u => u.user_number == userNumber);
            
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


// ==================== CRYPTO WITHDRAWAL FUNCTIONS ====================

let cryptoWithdrawalsFilter = 'all';

async function loadCryptoWithdrawals() {
    const statusParam = cryptoWithdrawalsFilter !== 'all' ? `?status=${cryptoWithdrawalsFilter}` : '';
    
    try {
        const response = await fetch(`${API_URL}/api/admin/crypto-withdrawals${statusParam}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            const tbody = document.getElementById('cryptoWithdrawalsTableBody');
            
            if (data.withdrawals && data.withdrawals.length > 0) {
                tbody.innerHTML = data.withdrawals.map(w => {
                    // Format date properly
                    let dateStr = '-';
                    if (w.request_timestamp) {
                        try {
                            const date = new Date(w.request_timestamp);
                            if (!isNaN(date.getTime())) {
                                dateStr = date.toLocaleString();
                            }
                        } catch (e) {
                            dateStr = w.request_timestamp;
                        }
                    }
                    
                    return `
                    <tr>
                        <td>
                            <strong>${w.user_name || 'Unknown'}</strong><br>
                            <small>${w.user_email || 'Unknown'}</small>
                        </td>
                        <td><strong>${w.amount} USDT</strong></td>
                        <td>${(w.wallet_type || '').replace(/_/g, ' ')}</td>
                        <td><code style="font-size:11px;">${w.crypto_address || 'Not set'}</code></td>
                        <td>${dateStr}</td>
                        <td><span class="status-badge ${w.status}">${w.status}</span></td>
                        <td>
                            ${w.status === 'pending' ? `
                                <button class="btn btn-success btn-sm" onclick="approveWithdrawal('${w.id}')">Approve</button>
                                <button class="btn btn-danger btn-sm" onclick="rejectWithdrawal('${w.id}')">Reject</button>
                            ` : '-'}
                        </td>
                    </tr>
                `}).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="7" class="empty">No withdrawals found</td></tr>';
            }
        }
    } catch (error) {
        console.error('Error loading crypto withdrawals:', error);
    }
}

function filterCryptoWithdrawals(status) {
    cryptoWithdrawalsFilter = status;
    
    // Update filter tabs
    document.querySelectorAll('#cryptoWithdrawalsPage .filter-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');
    
    loadCryptoWithdrawals();
}

async function approveWithdrawal(withdrawalId) {
    if (!confirm('Are you sure you want to approve this withdrawal?')) return;
    
    try {
        const response = await fetch(`${API_URL}/api/admin/crypto-withdrawals/${withdrawalId}/approve`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            alert('Withdrawal approved successfully!');
            loadCryptoWithdrawals();
        } else {
            const data = await response.json();
            alert(data.detail || 'Failed to approve withdrawal');
        }
    } catch (error) {
        alert('Error approving withdrawal');
    }
}

async function rejectWithdrawal(withdrawalId) {
    const reason = prompt('Enter rejection reason (optional):');
    
    try {
        const response = await fetch(`${API_URL}/api/admin/crypto-withdrawals/${withdrawalId}/reject?admin_notes=${encodeURIComponent(reason || '')}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            alert('Withdrawal rejected and funds refunded.');
            loadCryptoWithdrawals();
        } else {
            const data = await response.json();
            alert(data.detail || 'Failed to reject withdrawal');
        }
    } catch (error) {
        alert('Error rejecting withdrawal');
    }
}

// ==================== ROI LOGS FUNCTIONS ====================

async function loadROILogs() {
    try {
        const response = await fetch(`${API_URL}/api/admin/roi-logs`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            const tbody = document.getElementById('roiLogsTableBody');
            
            if (data.logs && data.logs.length > 0) {
                tbody.innerHTML = data.logs.map(log => `
                    <tr>
                        <td><strong>${log.user_name}</strong></td>
                        <td>$${log.invested_amount.toFixed(2)}</td>
                        <td style="color: #f39c12;">$${log.premium_amount.toFixed(2)}</td>
                        <td style="color: #27ae60;">$${log.daily_roi_amount.toFixed(2)}</td>
                        <td><strong>$${log.total_roi.toFixed(2)}</strong></td>
                        <td>${new Date(log.timestamp).toLocaleString()}</td>
                    </tr>
                `).join('');
            } else {
                tbody.innerHTML = '<tr><td colspan="6" class="empty">No ROI distribution logs yet</td></tr>';
            }
        }
    } catch (error) {
        console.error('Error loading ROI logs:', error);
    }
}

async function distributeROI() {
    if (!confirm('This will distribute daily ROI to all users with active investments. Continue?')) return;
    
    const resultDiv = document.getElementById('roiDistributionResult');
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<span style="color: #f39c12;">Distributing ROI...</span>';
    
    try {
        const response = await fetch(`${API_URL}/api/admin/distribute-roi`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            resultDiv.innerHTML = `
                <span style="color: #27ae60;">✓ ${data.message}</span><br>
                <small>Premium Distributed: $${data.total_premium_distributed?.toFixed(2) || 0}</small><br>
                <small>Daily ROI Distributed: $${data.total_daily_roi_distributed?.toFixed(2) || 0}</small>
            `;
            loadROILogs();
        } else {
            resultDiv.innerHTML = `<span style="color: #e74c3c;">✗ ${data.detail || data.message}</span>`;
        }
    } catch (error) {
        resultDiv.innerHTML = '<span style="color: #e74c3c;">✗ Error distributing ROI</span>';
    }
}

// ==================== SETTINGS FUNCTIONS ====================

async function loadSettings() {
    try {
        const response = await fetch(`${API_URL}/api/admin/settings`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            document.getElementById('investmentToggle').checked = data.investment_enabled;
            document.getElementById('investmentStatus').textContent = data.investment_enabled ? 'Active' : 'Disabled';
            document.getElementById('investmentStatus').className = `status-badge ${data.investment_enabled ? 'approved' : 'rejected'}`;
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function toggleInvestment() {
    try {
        const response = await fetch(`${API_URL}/api/admin/settings/toggle-investment`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            document.getElementById('investmentStatus').textContent = data.investment_enabled ? 'Active' : 'Disabled';
            document.getElementById('investmentStatus').className = `status-badge ${data.investment_enabled ? 'approved' : 'rejected'}`;
        }
    } catch (error) {
        console.error('Error toggling investment:', error);
    }
}

async function changeAdminPassword() {
    const currentPassword = document.getElementById('adminCurrentPassword').value;
    const newPassword = document.getElementById('adminNewPassword').value;
    const resultDiv = document.getElementById('adminPasswordResult');
    
    if (!currentPassword || !newPassword) {
        resultDiv.innerHTML = '<span style="color: #e74c3c;">Please fill all fields</span>';
        return;
    }
    
    if (newPassword.length < 6) {
        resultDiv.innerHTML = '<span style="color: #e74c3c;">Password must be at least 6 characters</span>';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/change-password`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            resultDiv.innerHTML = '<span style="color: #27ae60;">✓ Password changed successfully</span>';
            document.getElementById('adminCurrentPassword').value = '';
            document.getElementById('adminNewPassword').value = '';
        } else {
            resultDiv.innerHTML = `<span style="color: #e74c3c;">✗ ${data.detail}</span>`;
        }
    } catch (error) {
        resultDiv.innerHTML = '<span style="color: #e74c3c;">✗ Error changing password</span>';
    }
}

async function changeAdminEmail() {
    const newEmail = document.getElementById('adminNewEmail').value;
    const resultDiv = document.getElementById('adminEmailResult');
    
    if (!newEmail) {
        resultDiv.innerHTML = '<span style="color: #e74c3c;">Please enter an email</span>';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/update-email?new_email=${encodeURIComponent(newEmail)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            resultDiv.innerHTML = `<span style="color: #27ae60;">✓ Email updated to ${data.new_email}</span>`;
            document.getElementById('adminNewEmail').value = '';
        } else {
            resultDiv.innerHTML = `<span style="color: #e74c3c;">✗ ${data.detail}</span>`;
        }
    } catch (error) {
        resultDiv.innerHTML = '<span style="color: #e74c3c;">✗ Error updating email</span>';
    }
}

async function changeUserPassword() {
    const userId = document.getElementById('targetUserId').value;
    const newPassword = document.getElementById('userNewPassword').value;
    const resultDiv = document.getElementById('userPasswordResult');
    
    if (!userId || !newPassword) {
        resultDiv.innerHTML = '<span style="color: #e74c3c;">Please fill all fields</span>';
        return;
    }
    
    if (newPassword.length < 6) {
        resultDiv.innerHTML = '<span style="color: #e74c3c;">Password must be at least 6 characters</span>';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/admin/users/${userId}/change-password?new_password=${encodeURIComponent(newPassword)}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            resultDiv.innerHTML = `<span style="color: #27ae60;">✓ ${data.message}</span>`;
            document.getElementById('targetUserId').value = '';
            document.getElementById('userNewPassword').value = '';
        } else {
            resultDiv.innerHTML = `<span style="color: #e74c3c;">✗ ${data.detail}</span>`;
        }
    } catch (error) {
        resultDiv.innerHTML = '<span style="color: #e74c3c;">✗ Error changing password</span>';
    }
}
