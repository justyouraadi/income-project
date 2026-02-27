// API Base URL
const API_URL = window.location.origin;

// Auth token storage
let authToken = localStorage.getItem('userToken');
let currentUser = null;
let currentTransferId = null;

// Toggle Sidebar Function for Mobile
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    if (sidebar.classList.contains('open')) {
        // Close sidebar
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    } else {
        // Open sidebar
        sidebar.classList.add('open');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

// Close sidebar when clicking a nav item on mobile
function closeSidebarOnMobile() {
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Check auth on load
document.addEventListener('DOMContentLoaded', async function() {
    // Check for signup hash
    if (window.location.hash === '#signup') {
        showSignup();
    }
    
    if (authToken) {
        await checkAuth();
    }
    
    // Setup navigation
    setupNavigation();
});

// Check authentication
async function checkAuth() {
    try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            currentUser = await response.json();
            showMainApp();
        } else {
            authToken = null;
            localStorage.removeItem('userToken');
        }
    } catch (error) {
        console.error('Auth check failed:', error);
    }
}

// Auth Form Handlers
function showLogin() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('signupForm').style.display = 'none';
    document.getElementById('forgotForm').style.display = 'none';
}

function showSignup() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('signupForm').style.display = 'block';
    document.getElementById('forgotForm').style.display = 'none';
}

function showForgotPassword() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('signupForm').style.display = 'none';
    document.getElementById('forgotForm').style.display = 'block';
}

// Login Handler
async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    
    try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            authToken = data.access_token;
            localStorage.setItem('userToken', authToken);
            await checkAuth();
        } else {
            errorDiv.textContent = data.detail || 'Login failed. Please check your credentials.';
            errorDiv.classList.add('show');
            errorDiv.style.display = 'block';
        }
    } catch (error) {
        errorDiv.textContent = 'Network error. Please try again.';
        errorDiv.classList.add('show');
        errorDiv.style.display = 'block';
    }
}

// Signup Handler
async function handleSignup(event) {
    event.preventDefault();
    const fullName = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const referralCode = document.getElementById('signupReferral').value;
    const errorDiv = document.getElementById('signupError');
    const successDiv = document.getElementById('signupSuccess');
    
    try {
        const response = await fetch(`${API_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                full_name: fullName,
                email: email,
                password: password,
                referral_code: referralCode || null
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            successDiv.textContent = 'Account created successfully! Please login.';
            successDiv.classList.add('show');
            successDiv.style.display = 'block';
            errorDiv.style.display = 'none';
            
            // Clear form
            document.getElementById('signupName').value = '';
            document.getElementById('signupEmail').value = '';
            document.getElementById('signupPassword').value = '';
            document.getElementById('signupReferral').value = '';
            
            // Show login after 2 seconds
            setTimeout(showLogin, 2000);
        } else {
            errorDiv.textContent = data.detail || 'Registration failed. Please try again.';
            errorDiv.classList.add('show');
            errorDiv.style.display = 'block';
            successDiv.style.display = 'none';
        }
    } catch (error) {
        errorDiv.textContent = 'Network error. Please try again.';
        errorDiv.classList.add('show');
        errorDiv.style.display = 'block';
    }
}

// Forgot Password Handler
async function handleForgotPassword(event) {
    event.preventDefault();
    const email = document.getElementById('forgotEmail').value;
    const messageDiv = document.getElementById('forgotMessage');
    
    // For now, show a message (actual reset would require email integration)
    messageDiv.textContent = 'If this email exists, password reset instructions will be sent.';
    messageDiv.classList.add('show');
    messageDiv.style.display = 'block';
}

// Show Main App
function showMainApp() {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'flex';
    
    // Update user info
    document.getElementById('userNameSidebar').textContent = currentUser.full_name;
    document.getElementById('userNameDisplay').textContent = currentUser.full_name;
    document.getElementById('userIdDisplay').textContent = `#${currentUser.user_number || '000000'}`;
    
    // Load dashboard data
    loadDashboard();
}

// Logout
function logout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('userToken');
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    showLogin();
}

// Navigation Setup
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item[data-page]');
    
    navItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const page = this.getAttribute('data-page');
            navigateTo(page);
        });
    });
}

function navigateTo(page) {
    // Close sidebar on mobile when navigating
    closeSidebarOnMobile();
    
    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
    
    // Hide all pages
    document.querySelectorAll('.page-content').forEach(p => {
        p.style.display = 'none';
    });
    
    // Show selected page
    const pageElement = document.getElementById(`${page}Page`);
    if (pageElement) {
        pageElement.style.display = 'block';
    }
    
    // Update title
    const titles = {
        'dashboard': 'Dashboard',
        'wallet': 'My Wallets',
        'invest': 'Make Investment',
        'p2p': 'P2P Transfer',
        'team': 'My Team',
        'withdraw': 'Withdraw Funds',
        'learn': 'Learning Center',
        'profile': 'My Profile'
    };
    document.getElementById('pageTitle').textContent = titles[page] || 'Dashboard';
    
    // Load page data
    loadPageData(page);
}

function loadPageData(page) {
    switch(page) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'wallet':
            loadWallets();
            break;
        case 'p2p':
            loadP2PHistory();
            break;
        case 'team':
            loadTeam();
            break;
        case 'withdraw':
            loadWithdrawals();
            break;
        case 'profile':
            loadProfile();
            break;
    }
}

// Load Dashboard
async function loadDashboard() {
    try {
        // Load wallet data
        const walletRes = await fetch(`${API_URL}/api/wallet`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (walletRes.ok) {
            const wallet = await walletRes.json();
            const totalBalance = (wallet.daily_roi || 0) + (wallet.direct_income || 0) + 
                                (wallet.slab_income || 0) + (wallet.royalty_income || 0) + 
                                (wallet.salary_income || 0);
            
            document.getElementById('totalBalance').textContent = `$${totalBalance.toFixed(2)}`;
        }
        
        // Load user data
        const userRes = await fetch(`${API_URL}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (userRes.ok) {
            const user = await userRes.json();
            document.getElementById('totalInvestment').textContent = `$${(user.total_investment || 0).toFixed(2)}`;
            document.getElementById('teamSize').textContent = user.team_size || 0;
            document.getElementById('totalWithdrawn').textContent = `$${(user.total_withdrawn || 0).toFixed(2)}`;
            
            // Set referral link
            const referralLink = `${window.location.origin}/api/user/#signup?ref=${user.referral_code}`;
            document.getElementById('referralLink').value = referralLink;
        }
        
        // Load recent transactions
        const txRes = await fetch(`${API_URL}/api/transactions?limit=5`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (txRes.ok) {
            const data = await txRes.json();
            const container = document.getElementById('recentTransactions');
            
            if (data.transactions && data.transactions.length > 0) {
                container.innerHTML = data.transactions.map(tx => `
                    <div class="transaction-item">
                        <div class="transaction-info">
                            <span class="transaction-type">${tx.type.replace(/_/g, ' ')}</span>
                            <span class="transaction-date">${new Date(tx.date).toLocaleString()}</span>
                        </div>
                        <span class="transaction-amount ${tx.amount >= 0 ? 'positive' : 'negative'}">
                            ${tx.amount >= 0 ? '+' : ''}$${Math.abs(tx.amount).toFixed(2)}
                        </span>
                    </div>
                `).join('');
            } else {
                container.innerHTML = '<p class="empty-state">No transactions yet</p>';
            }
        }
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

// Load Salary Status
async function loadSalaryStatus() {
    const container = document.getElementById('salaryStatusContent');
    if (!container) return;
    
    try {
        const response = await fetch(`${API_URL}/api/user/salary-status`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            const bv = data.business_volume;
            const eligibility = data.eligibility;
            const salary = data.current_salary;
            const tier = data.salary_tier;
            
            // Calculate progress
            const monthsProgress = salary.active ? (salary.months_paid / 10) * 100 : 0;
            
            container.innerHTML = `
                <div class="salary-status-grid">
                    <div class="salary-stat">
                        <span class="salary-stat-value">$${(bv.total || 0).toFixed(0)}</span>
                        <span class="salary-stat-label">Team Business Volume</span>
                    </div>
                    <div class="salary-stat">
                        <span class="salary-stat-value">${tier ? '$' + tier.monthly_salary : 'N/A'}</span>
                        <span class="salary-stat-label">Monthly Salary</span>
                    </div>
                </div>
                
                <div class="salary-eligibility ${eligibility.eligible ? 'eligible' : 'not-eligible'}">
                    ${eligibility.eligible 
                        ? '✅ You are eligible for monthly salary!' 
                        : `❌ ${eligibility.reason}`}
                    <br><small>Power Leg: ${eligibility.power_leg_percent}% | Weaker Legs: ${eligibility.weaker_legs_percent}%</small>
                    <br><small>(Required: Max 40% Power Leg, Min 60% Weaker Legs)</small>
                </div>
                
                ${salary.active ? `
                    <div class="salary-progress">
                        <div style="display: flex; justify-content: space-between;">
                            <span>Salary Progress</span>
                            <span>${salary.months_paid} / 10 months</span>
                        </div>
                        <div class="salary-progress-bar">
                            <div class="salary-progress-fill" style="width: ${monthsProgress}%"></div>
                        </div>
                        <div style="margin-top: 10px; display: flex; justify-content: space-between; font-size: 13px;">
                            <span>Total Earned: <strong style="color: var(--success);">$${salary.total_earned.toFixed(2)}</strong></span>
                            <span>Remaining: <strong>${salary.months_remaining} months</strong></span>
                        </div>
                    </div>
                ` : ''}
                
                <div class="salary-tier-info">
                    <strong>Salary Tiers:</strong>
                    <table class="salary-tier-table">
                        <tr ${bv.total >= 30000 && eligibility.eligible ? 'class="active-tier"' : ''}>
                            <td>$30,000+</td><td>$60/month</td><td>10 months</td>
                        </tr>
                        <tr ${bv.total >= 15000 && bv.total < 30000 && eligibility.eligible ? 'class="active-tier"' : ''}>
                            <td>$15,000+</td><td>$45/month</td><td>10 months</td>
                        </tr>
                        <tr ${bv.total >= 10000 && bv.total < 15000 && eligibility.eligible ? 'class="active-tier"' : ''}>
                            <td>$10,000+</td><td>$30/month</td><td>10 months</td>
                        </tr>
                        <tr ${bv.total >= 5000 && bv.total < 10000 && eligibility.eligible ? 'class="active-tier"' : ''}>
                            <td>$5,000+</td><td>$15/month</td><td>10 months</td>
                        </tr>
                    </table>
                </div>
            `;
        } else {
            container.innerHTML = '<p class="empty-state">Unable to load salary status</p>';
        }
    } catch (error) {
        console.error('Error loading salary status:', error);
        container.innerHTML = '<p class="empty-state">Error loading salary status</p>';
    }
}

// Load Wallets
async function loadWallets() {
    try {
        const response = await fetch(`${API_URL}/api/wallet`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const wallet = await response.json();
            
            document.getElementById('dailyRoiBalance').textContent = `$${(wallet.daily_roi || 0).toFixed(2)}`;
            document.getElementById('directIncomeBalance').textContent = `$${(wallet.direct_income || 0).toFixed(2)}`;
            document.getElementById('slabIncomeBalance').textContent = `$${(wallet.slab_income || 0).toFixed(2)}`;
            document.getElementById('royaltyIncomeBalance').textContent = `$${(wallet.royalty_income || 0).toFixed(2)}`;
            document.getElementById('salaryIncomeBalance').textContent = `$${(wallet.salary_income || 0).toFixed(2)}`;
            
            const total = (wallet.daily_roi || 0) + (wallet.direct_income || 0) + 
                         (wallet.slab_income || 0) + (wallet.royalty_income || 0) + 
                         (wallet.salary_income || 0);
            document.getElementById('mainWalletBalance').textContent = `$${total.toFixed(2)}`;
            document.getElementById('withdrawableBalance').textContent = `$${total.toFixed(2)}`;
        }
    } catch (error) {
        console.error('Error loading wallets:', error);
    }
}

// Make Investment
async function makeInvestment() {
    const amount = parseFloat(document.getElementById('investAmount').value);
    const plan = document.getElementById('investPlan').value;
    const messageDiv = document.getElementById('investMessage');
    
    if (!amount || amount < 100) {
        messageDiv.textContent = 'Minimum investment is $100';
        messageDiv.className = 'message error';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/wallet/invest`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ amount, plan })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            messageDiv.textContent = `Investment of $${amount} successful!`;
            messageDiv.className = 'message success';
            document.getElementById('investAmount').value = '';
            loadDashboard();
        } else {
            messageDiv.textContent = data.detail || 'Investment failed';
            messageDiv.className = 'message error';
        }
    } catch (error) {
        messageDiv.textContent = 'Network error. Please try again.';
        messageDiv.className = 'message error';
    }
}

// P2P Transfer Functions
document.getElementById('p2pRecipientId')?.addEventListener('blur', async function() {
    const userNumber = this.value;
    const infoDiv = document.getElementById('p2pRecipientInfo');
    
    if (!userNumber) {
        infoDiv.style.display = 'none';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/p2p/lookup-user/${userNumber}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const user = await response.json();
            infoDiv.innerHTML = `<span class="success">✓ ${user.full_name}</span>`;
            infoDiv.className = 'recipient-info success';
            infoDiv.style.display = 'block';
        } else {
            const data = await response.json();
            infoDiv.innerHTML = `<span class="error">✗ ${data.detail || 'User not found'}</span>`;
            infoDiv.className = 'recipient-info error';
            infoDiv.style.display = 'block';
        }
    } catch (error) {
        infoDiv.innerHTML = '<span class="error">✗ Error looking up user</span>';
        infoDiv.className = 'recipient-info error';
        infoDiv.style.display = 'block';
    }
});

async function initiateP2PTransfer() {
    const recipientId = document.getElementById('p2pRecipientId').value;
    const amount = parseFloat(document.getElementById('p2pAmountInput').value);
    const messageDiv = document.getElementById('p2pMessage');
    
    if (!recipientId) {
        messageDiv.textContent = 'Please enter recipient User ID';
        messageDiv.className = 'message error';
        return;
    }
    
    if (!amount || amount <= 0) {
        messageDiv.textContent = 'Please enter a valid amount';
        messageDiv.className = 'message error';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/p2p/initiate-transfer`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                recipient_user_number: parseInt(recipientId),
                amount: amount
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            currentTransferId = data.transfer_id;
            messageDiv.textContent = `OTP sent to ${data.otp_sent_to}. Please verify.`;
            messageDiv.className = 'message success';
            
            // Show OTP modal
            document.getElementById('otpModal').style.display = 'flex';
        } else {
            messageDiv.textContent = data.detail || 'Transfer initiation failed';
            messageDiv.className = 'message error';
        }
    } catch (error) {
        messageDiv.textContent = 'Network error. Please try again.';
        messageDiv.className = 'message error';
    }
}

async function verifyP2PTransfer() {
    const otp = document.getElementById('otpInput').value;
    const messageDiv = document.getElementById('otpMessage');
    
    if (!otp || otp.length !== 6) {
        messageDiv.textContent = 'Please enter 6-digit OTP';
        messageDiv.className = 'message error';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/p2p/verify-transfer`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                transfer_id: currentTransferId,
                otp: otp
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            closeOtpModal();
            document.getElementById('p2pMessage').textContent = `Transfer of $${data.amount} to ${data.recipient} successful!`;
            document.getElementById('p2pMessage').className = 'message success';
            
            // Clear form
            document.getElementById('p2pRecipientId').value = '';
            document.getElementById('p2pAmountInput').value = '';
            document.getElementById('p2pRecipientInfo').style.display = 'none';
            
            // Reload data
            loadP2PHistory();
            loadWallets();
        } else {
            messageDiv.textContent = data.detail || 'OTP verification failed';
            messageDiv.className = 'message error';
        }
    } catch (error) {
        messageDiv.textContent = 'Network error. Please try again.';
        messageDiv.className = 'message error';
    }
}

function closeOtpModal() {
    document.getElementById('otpModal').style.display = 'none';
    document.getElementById('otpInput').value = '';
    document.getElementById('otpMessage').textContent = '';
    currentTransferId = null;
}

async function loadP2PHistory() {
    try {
        const response = await fetch(`${API_URL}/api/p2p/transfer-history`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            const container = document.getElementById('p2pHistory');
            
            if (data.transfers && data.transfers.length > 0) {
                container.innerHTML = data.transfers.map(t => `
                    <div class="transfer-item">
                        <div class="transfer-info">
                            <span class="transfer-user">${t.type === 'sent' ? 'To' : 'From'}: #${t.other_user_number} (${t.other_user_name})</span>
                            <span class="transfer-date">${new Date(t.date).toLocaleString()}</span>
                        </div>
                        <span class="transfer-amount ${t.type === 'received' ? 'received' : 'sent'}">
                            ${t.type === 'received' ? '+' : '-'}$${Math.abs(t.amount).toFixed(2)}
                        </span>
                    </div>
                `).join('');
            } else {
                container.innerHTML = '<p class="empty-state">No transfers yet</p>';
            }
        }
    } catch (error) {
        console.error('Error loading P2P history:', error);
    }
}

// Load Team
async function loadTeam() {
    try {
        const response = await fetch(`${API_URL}/api/team/members`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            document.getElementById('totalTeamMembers').textContent = data.total_team || 0;
            document.getElementById('directReferrals').textContent = data.direct_referrals || 0;
            
            const container = document.getElementById('teamList');
            
            if (data.members && data.members.length > 0) {
                container.innerHTML = data.members.map(m => `
                    <div class="team-member">
                        <div class="team-member-info">
                            <span class="team-member-name">${m.full_name}</span>
                            <span class="team-member-date">Joined: ${new Date(m.joined_date).toLocaleDateString()}</span>
                        </div>
                        <span>#${m.user_number}</span>
                    </div>
                `).join('');
            } else {
                container.innerHTML = '<p class="empty-state">No team members yet. Share your referral link!</p>';
            }
        }
    } catch (error) {
        console.error('Error loading team:', error);
    }
}

// Request Withdrawal
async function requestWithdrawal() {
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    const method = document.getElementById('withdrawMethod').value;
    const details = document.getElementById('withdrawDetails').value;
    const messageDiv = document.getElementById('withdrawMessage');
    
    if (!amount || amount < 10) {
        messageDiv.textContent = 'Minimum withdrawal is $10';
        messageDiv.className = 'message error';
        return;
    }
    
    if (!details) {
        messageDiv.textContent = 'Please enter payment details';
        messageDiv.className = 'message error';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/user/withdrawal-request`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: amount,
                payment_method: method,
                payment_info: details
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            messageDiv.textContent = 'Withdrawal request submitted successfully!';
            messageDiv.className = 'message success';
            document.getElementById('withdrawAmount').value = '';
            document.getElementById('withdrawDetails').value = '';
            loadWithdrawals();
        } else {
            messageDiv.textContent = data.detail || 'Withdrawal request failed';
            messageDiv.className = 'message error';
        }
    } catch (error) {
        messageDiv.textContent = 'Network error. Please try again.';
        messageDiv.className = 'message error';
    }
}

async function loadWithdrawals() {
    // Also update withdrawable balance
    loadWallets();
    
    try {
        const response = await fetch(`${API_URL}/api/user/withdrawals`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            const container = document.getElementById('withdrawalHistory');
            
            if (data.withdrawals && data.withdrawals.length > 0) {
                container.innerHTML = data.withdrawals.map(w => `
                    <div class="withdrawal-item">
                        <div class="withdrawal-info">
                            <span class="withdrawal-amount">$${w.amount.toFixed(2)}</span>
                            <span class="withdrawal-date">${new Date(w.request_timestamp).toLocaleString()}</span>
                        </div>
                        <span class="withdrawal-status ${w.status}">${w.status}</span>
                    </div>
                `).join('');
            } else {
                container.innerHTML = '<p class="empty-state">No withdrawals yet</p>';
            }
        }
    } catch (error) {
        console.error('Error loading withdrawals:', error);
    }
}

// Load Profile
function loadProfile() {
    if (currentUser) {
        document.getElementById('profileName').textContent = currentUser.full_name;
        document.getElementById('profileId').textContent = `#${currentUser.user_number || '000000'}`;
        document.getElementById('profileEmail').textContent = currentUser.email;
        document.getElementById('profileReferralCode').textContent = currentUser.referral_code || '-';
        document.getElementById('profileJoinDate').textContent = currentUser.joined_date ? 
            new Date(currentUser.joined_date).toLocaleDateString() : '-';
        document.getElementById('profileStatus').textContent = currentUser.status || 'Active';
    }
}

// Copy referral link
function copyReferralLink() {
    const input = document.getElementById('referralLink');
    input.select();
    document.execCommand('copy');
    alert('Referral link copied to clipboard!');
}

// Referral Code Verification
let referralLookupTimeout = null;

document.getElementById('signupReferral')?.addEventListener('input', function() {
    const code = this.value.trim();
    const infoDiv = document.getElementById('referrerInfo');
    
    // Clear previous timeout
    if (referralLookupTimeout) {
        clearTimeout(referralLookupTimeout);
    }
    
    // Hide if empty
    if (!code) {
        infoDiv.style.display = 'none';
        infoDiv.className = 'referrer-info';
        return;
    }
    
    // Show loading state
    infoDiv.textContent = 'Verifying referral code...';
    infoDiv.className = 'referrer-info loading';
    infoDiv.style.display = 'block';
    
    // Debounce the lookup
    referralLookupTimeout = setTimeout(async () => {
        await lookupReferrer(code);
    }, 500);
});

async function lookupReferrer(code) {
    const infoDiv = document.getElementById('referrerInfo');
    
    try {
        const response = await fetch(`${API_URL}/api/auth/lookup-referrer/${encodeURIComponent(code)}`);
        const data = await response.json();
        
        if (data.found) {
            infoDiv.innerHTML = `<strong>Referrer Found:</strong> ${data.name} ${data.user_number ? '(#' + data.user_number + ')' : ''}`;
            infoDiv.className = 'referrer-info success';
        } else {
            infoDiv.textContent = 'Invalid referral code. Please check and try again.';
            infoDiv.className = 'referrer-info error';
        }
    } catch (error) {
        console.error('Error looking up referrer:', error);
        infoDiv.textContent = 'Error verifying code. Please try again.';
        infoDiv.className = 'referrer-info error';
    }
}
