// API Base URL
const API_URL = window.location.origin;

// Auth token storage
let authToken = localStorage.getItem('userToken');
let currentUser = null;
let currentTransferId = null;

// PWA Install prompt
let deferredPrompt = null;

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/api/user/sw.js')
        .then(reg => console.log('Service Worker registered'))
        .catch(err => console.log('Service Worker registration failed:', err));
}

// Listen for beforeinstallprompt event
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Show install popup if user hasn't dismissed it before
    checkAndShowInstallPopup();
});

// Check if we should show install popup
function checkAndShowInstallPopup() {
    const dismissed = localStorage.getItem('installPopupDismissed');
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    
    // Don't show if already installed, dismissed, or no install prompt available
    if (dismissed || isStandalone || !deferredPrompt) {
        return;
    }
    
    // Show popup only on auth screen (login/signup)
    const authScreen = document.getElementById('authScreen');
    if (authScreen && authScreen.style.display !== 'none') {
        showInstallPopup();
    }
}

// Show install popup
function showInstallPopup() {
    const popup = document.getElementById('installPopup');
    if (popup && deferredPrompt) {
        popup.style.display = 'flex';
    }
}

// Install the app
async function installApp() {
    const popup = document.getElementById('installPopup');
    
    if (deferredPrompt) {
        // Show the native install prompt
        deferredPrompt.prompt();
        
        // Wait for user response
        const { outcome } = await deferredPrompt.userChoice;
        
        console.log('Install outcome:', outcome);
        
        // Clear the deferred prompt
        deferredPrompt = null;
    }
    
    // Hide popup
    if (popup) {
        popup.style.display = 'none';
    }
    
    // Mark as dismissed so it doesn't show again
    localStorage.setItem('installPopupDismissed', 'true');
}

// Dismiss install popup
function dismissInstallPopup() {
    const popup = document.getElementById('installPopup');
    if (popup) {
        popup.style.display = 'none';
    }
    // Remember user's choice
    localStorage.setItem('installPopupDismissed', 'true');
}

// Check auth on load
document.addEventListener('DOMContentLoaded', async function() {
    // Check for signup hash with optional referral code
    const hash = window.location.hash;
    const urlParams = new URLSearchParams(window.location.search);
    
    // Handle hash-based referral (e.g., #signup?ref=CODE)
    if (hash.startsWith('#signup')) {
        showSignup();
        
        // Extract referral code from hash params
        const hashParams = hash.includes('?') ? new URLSearchParams(hash.split('?')[1]) : null;
        const refCode = hashParams?.get('ref') || urlParams.get('ref');
        
        if (refCode) {
            const referralInput = document.getElementById('signupReferral');
            if (referralInput) {
                referralInput.value = refCode;
                // Trigger referrer lookup
                lookupReferrer(refCode);
            }
        }
    }
    
    // Also check for ref param without hash (direct URL param)
    const directRefCode = urlParams.get('ref');
    if (directRefCode && !hash.startsWith('#signup')) {
        showSignup();
        const referralInput = document.getElementById('signupReferral');
        if (referralInput) {
            referralInput.value = directRefCode;
            lookupReferrer(directRefCode);
        }
    }
    
    if (authToken) {
        await checkAuth();
        // Check for payment status after returning from NOWPayments
        checkPaymentStatus();
    }
    
    // Setup navigation
    setupNavigation();
    
    // Setup mobile navigation (close sidebar on nav click)
    setupMobileNavigation();
    
    // Check and show install popup if on auth screen and not already installed
    if (!authToken) {
        // Delay to allow beforeinstallprompt to fire first
        setTimeout(() => {
            checkAndShowInstallPopup();
        }, 2000);
    }
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
        'profile': 'My Profile',
        'help': 'Help & Support'
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
            
            // Handle both array response (old API) and object response (new API)
            const transactions = Array.isArray(data) ? data : (data.transactions || []);
            
            if (transactions.length > 0) {
                container.innerHTML = transactions.slice(0, 5).map(tx => `
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
        
        // Load active investments with progress
        const invRes = await fetch(`${API_URL}/api/investments/active`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (invRes.ok) {
            const investments = await invRes.json();
            const invContainer = document.getElementById('activeInvestments');
            
            if (investments.length > 0) {
                // Add SVG gradient definition once
                const gradientDef = `
                    <svg width="0" height="0" style="position:absolute">
                        <defs>
                            <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" style="stop-color:#f39c12" />
                                <stop offset="100%" style="stop-color:#27ae60" />
                            </linearGradient>
                        </defs>
                    </svg>
                `;
                
                invContainer.innerHTML = gradientDef + investments.map(inv => {
                    // Calculate SVG circle properties
                    const radius = 32;
                    const circumference = 2 * Math.PI * radius;
                    const strokeDashoffset = circumference - (inv.progress_percent / 100) * circumference;
                    
                    return `
                    <div class="investment-item">
                        <div class="investment-circular-progress">
                            <svg viewBox="0 0 80 80">
                                <circle class="progress-bg" cx="40" cy="40" r="${radius}"></circle>
                                <circle class="progress-fill" cx="40" cy="40" r="${radius}" 
                                    stroke-dasharray="${circumference}" 
                                    stroke-dashoffset="${strokeDashoffset}">
                                </circle>
                            </svg>
                            <div class="progress-text">
                                <span class="progress-percent">${Math.round(inv.progress_percent)}%</span>
                                <span class="progress-label">Complete</span>
                            </div>
                        </div>
                        <div class="investment-details-container">
                            <div class="investment-header">
                                <span class="investment-amount">$${inv.amount.toFixed(2)}</span>
                                <span class="investment-plan">${inv.plan}</span>
                            </div>
                            <div class="investment-info-row">
                                <div class="investment-days">
                                    Day <span>${inv.days_elapsed}</span> of ${inv.validity_days}
                                </div>
                                <div class="investment-status">Active</div>
                            </div>
                            <div class="investment-dates">
                                <span>Started: ${new Date(inv.start_date).toLocaleDateString()}</span>
                                <span>Ends: ${new Date(inv.end_date).toLocaleDateString()}</span>
                            </div>
                        </div>
                    </div>
                `}).join('');
            } else {
                invContainer.innerHTML = '<p class="empty-state">No active investments. <a href="#" onclick="showPage(\'invest\')">Invest now!</a></p>';
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
    const cryptocurrency = document.getElementById('investCrypto')?.value || 'btc';
    const messageDiv = document.getElementById('investMessage');
    const investBtn = document.getElementById('investBtn');
    
    // if (!amount || amount < 20) {
    //     messageDiv.textContent = 'Minimum investment is $20';
    //     messageDiv.className = 'message error';
    //     return;
    // }
    
    // Show loading state
    if (investBtn) {
        investBtn.disabled = true;
        investBtn.innerHTML = '<span class="spinner"></span> Processing...';
    }
    
    try {
        const response = await fetch(`${API_URL}/api/wallet/invest`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ amount, plan, cryptocurrency })
        });
        
        const data = await response.json();
        
        if (response.ok && data.checkout_url) {
            // Show payment details before redirect (invoice-based)
            const cryptoName = getCryptoName(cryptocurrency);
            messageDiv.innerHTML = `
                <div class="crypto-payment-info">
                    <p><strong>Payment initiated!</strong></p>
                    <p>Amount: <strong>$${amount} USD</strong></p>
                    <p>Pay with: <strong>${cryptoName}</strong></p>
                    <p>Invoice ID: <strong>${data.invoice_id || 'N/A'}</strong></p>
                    <p>Redirecting to secure payment page...</p>
                </div>
            `;
            messageDiv.className = 'message success';
            
            // Redirect to NOWPayments hosted checkout after a brief delay
            setTimeout(() => {
                window.location.href = data.checkout_url;
            }, 1500);
        } else if (response.ok) {
            messageDiv.textContent = `Investment of $${amount} initiated!`;
            messageDiv.className = 'message success';
            document.getElementById('investAmount').value = '';
            loadDashboard();
        } else {
            // Handle error - extract detail message properly
            const errorMsg = typeof data === 'object' ? (data.detail || data.message || 'Investment failed') : String(data);
            messageDiv.textContent = errorMsg;
            messageDiv.className = 'message error';
        }
    } catch (error) {
        messageDiv.textContent = 'Network error. Please try again.';
        messageDiv.className = 'message error';
    } finally {
        // Reset button state
        if (investBtn) {
            investBtn.disabled = false;
            investBtn.innerHTML = '<i class="fas fa-coins"></i> Invest Now';
        }
    }
}

// Helper function to get crypto display name
function getCryptoName(code) {
    const cryptoNames = {
        'btc': 'Bitcoin (BTC)',
        'eth': 'Ethereum (ETH)',
        'usdttrc20': 'Tether USDT (TRC20)',
        'usdcerc20': 'USD Coin (ERC20)',
        'bnbmainnet': 'Binance Coin (BNB)',
        'ltc': 'Litecoin (LTC)',
        'doge': 'Dogecoin (DOGE)',
        'xrp': 'XRP (Ripple)',
        'trx': 'Tron (TRX)',
        'sol': 'Solana (SOL)'
    };
    return cryptoNames[code] || code.toUpperCase();
}

// Check for payment success/cancelled in URL
function checkPaymentStatus() {
    const urlParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    
    if (hash.includes('payment=success')) {
        const investmentId = urlParams.get('investment_id') || new URLSearchParams(hash.split('?')[1]).get('investment_id');
        showPaymentSuccessNotification(investmentId);
    } else if (hash.includes('payment=cancelled')) {
        showPaymentCancelledNotification();
    }
}

function showPaymentSuccessNotification(investmentId) {
    // Create a toast/modal notification
    const notification = document.createElement('div');
    notification.className = 'payment-notification success';
    notification.innerHTML = `
        <div class="payment-notification-content">
            <i class="fas fa-check-circle"></i>
            <h3>Payment Successful!</h3>
            <p>Your crypto payment has been received. Your investment is now active.</p>
            <button onclick="this.parentElement.parentElement.remove(); navigateTo('dashboard');">View Dashboard</button>
        </div>
    `;
    document.body.appendChild(notification);
    
    // Auto-dismiss after 10 seconds
    setTimeout(() => notification.remove(), 10000);
    
    // Refresh dashboard data
    loadDashboard();
}

function showPaymentCancelledNotification() {
    const notification = document.createElement('div');
    notification.className = 'payment-notification warning';
    notification.innerHTML = `
        <div class="payment-notification-content">
            <i class="fas fa-exclamation-triangle"></i>
            <h3>Payment Cancelled</h3>
            <p>Your payment was cancelled. You can try again anytime.</p>
            <button onclick="this.parentElement.parentElement.remove();">Close</button>
        </div>
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => notification.remove(), 5000);
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
            
            // Handle both array response (old API) and object response (new API)
            let members = [];
            let totalTeam = 0;
            let directReferrals = 0;
            
            if (Array.isArray(data)) {
                // Old API format: returns array directly
                members = data;
                totalTeam = data.length;
                directReferrals = data.length;
            } else {
                // New API format: returns object with members array
                members = data.members || [];
                totalTeam = data.total_team || 0;
                directReferrals = data.direct_referrals || 0;
            }
            
            document.getElementById('totalTeamMembers').textContent = totalTeam;
            document.getElementById('directReferrals').textContent = directReferrals;
            
            const container = document.getElementById('teamList');
            
            if (members.length > 0) {
                container.innerHTML = members.map(m => `
                    <div class="team-member">
                        <div class="team-member-info">
                            <span class="team-member-name">${m.full_name}</span>
                            <span class="team-member-date">Joined: ${new Date(m.joined_date).toLocaleDateString()}</span>
                        </div>
                        <span>${m.user_number ? '#' + m.user_number : ''}</span>
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

// Toggle Sidebar for Mobile
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const hamburger = document.getElementById('hamburgerBtn');
    
    if (sidebar && overlay) {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('show');
        if (hamburger) {
            hamburger.classList.toggle('active');
        }
    }
}

// Close sidebar when clicking a nav item on mobile
function setupMobileNavigation() {
    const navItems = document.querySelectorAll('.nav-item[data-page]');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const hamburger = document.getElementById('hamburgerBtn');
    
    navItems.forEach(item => {
        item.addEventListener('click', function() {
            // Close sidebar on mobile after navigation
            if (window.innerWidth <= 768) {
                if (sidebar) sidebar.classList.remove('open');
                if (overlay) overlay.classList.remove('show');
                if (hamburger) hamburger.classList.remove('active');
            }
        });
    });
}

// Handle window resize - close sidebar overlay if window becomes larger
window.addEventListener('resize', function() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const hamburger = document.getElementById('hamburgerBtn');
    
    if (window.innerWidth > 768) {
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        if (hamburger) hamburger.classList.remove('active');
    }
});

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


// ==================== FAQ TOGGLE ====================
function toggleFaq(element) {
    // Close all other FAQs in the same category
    const category = element.closest('.faq-category');
    const allFaqs = category.querySelectorAll('.faq-item');
    
    allFaqs.forEach(faq => {
        if (faq !== element) {
            faq.classList.remove('active');
        }
    });
    
    // Toggle current FAQ
    element.classList.toggle('active');
}

// ==================== SUPPORT TICKETS ====================

async function loadUserTickets() {
    const container = document.getElementById('userTicketsList');
    container.innerHTML = '<div class="loading-tickets">Loading your tickets...</div>';
    
    try {
        const response = await fetch(`${API_URL}/api/tickets`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            renderUserTickets(data.tickets || []);
        } else {
            container.innerHTML = '<div class="loading-tickets">Error loading tickets</div>';
        }
    } catch (error) {
        console.error('Error loading tickets:', error);
        container.innerHTML = '<div class="loading-tickets">Error loading tickets</div>';
    }
}

function renderUserTickets(tickets) {
    const container = document.getElementById('userTicketsList');
    
    if (!tickets || tickets.length === 0) {
        container.innerHTML = `
            <div class="no-tickets">
                <div class="no-tickets-icon">🎫</div>
                <p>No tickets yet</p>
                <small>Submit a ticket if you need help</small>
            </div>
        `;
        return;
    }
    
    container.innerHTML = tickets.map(ticket => `
        <div class="ticket-item" onclick="viewTicketDetails('${ticket.id}')">
            <div class="ticket-item-header">
                <span class="ticket-number">${ticket.ticket_number}</span>
                <span class="ticket-status ${ticket.status}">${ticket.status.replace('_', ' ')}</span>
            </div>
            <div class="ticket-subject">${ticket.subject}</div>
            <div class="ticket-meta">
                <span class="ticket-category">${ticket.category}</span>
                <span class="ticket-date">${new Date(ticket.created_at).toLocaleDateString()}</span>
            </div>
        </div>
    `).join('');
}

async function submitTicket(event) {
    event.preventDefault();
    
    const category = document.getElementById('ticketCategory').value;
    const priority = document.getElementById('ticketPriority').value;
    const subject = document.getElementById('ticketSubject').value;
    const message = document.getElementById('ticketMessage').value;
    
    if (!category || !subject || !message) {
        alert('Please fill in all required fields');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/tickets`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ category, priority, subject, message })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert(`Ticket created successfully!\nTicket #: ${data.ticket_number}`);
            document.getElementById('ticketForm').reset();
            loadUserTickets();
        } else {
            alert(data.detail || 'Failed to create ticket');
        }
    } catch (error) {
        console.error('Error creating ticket:', error);
        alert('Error creating ticket. Please try again.');
    }
}

async function viewTicketDetails(ticketId) {
    try {
        const response = await fetch(`${API_URL}/api/tickets/${ticketId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const ticket = await response.json();
            showTicketModal(ticket);
        } else {
            alert('Error loading ticket details');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error loading ticket details');
    }
}

function showTicketModal(ticket) {
    // Create modal if it doesn't exist
    let modal = document.getElementById('ticketDetailModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'ticketDetailModal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    const messagesHtml = ticket.messages.map(msg => `
        <div class="message-item ${msg.sender}">
            <div class="message-header">
                <span class="message-sender">${msg.sender === 'admin' ? '👨‍💼 Support' : '👤 You'}</span>
                <span class="message-time">${new Date(msg.timestamp).toLocaleString()}</span>
            </div>
            <div class="message-text">${msg.message}</div>
        </div>
    `).join('');
    
    const canReply = ticket.status !== 'closed';
    
    modal.innerHTML = `
        <div class="modal-content ticket-modal-content">
            <span class="modal-close" onclick="closeTicketModal()">&times;</span>
            
            <div class="ticket-detail-header">
                <h3>${ticket.ticket_number} - ${ticket.subject}</h3>
                <div class="ticket-detail-meta">
                    <span>📁 ${ticket.category}</span>
                    <span>⚡ ${ticket.priority}</span>
                    <span class="ticket-status ${ticket.status}">${ticket.status.replace('_', ' ')}</span>
                </div>
            </div>
            
            <div class="messages-container">
                ${messagesHtml}
            </div>
            
            ${canReply ? `
                <div class="ticket-reply-form">
                    <textarea id="ticketReplyMessage" placeholder="Type your reply..."></textarea>
                    <button class="btn btn-primary" onclick="replyToTicket('${ticket.id}')">Send Reply</button>
                </div>
            ` : '<p style="color: var(--text-muted); text-align: center;">This ticket is closed</p>'}
        </div>
    `;
    
    modal.style.display = 'flex';
}

function closeTicketModal() {
    const modal = document.getElementById('ticketDetailModal');
    if (modal) modal.style.display = 'none';
}

async function replyToTicket(ticketId) {
    const message = document.getElementById('ticketReplyMessage').value.trim();
    
    if (!message) {
        alert('Please enter a message');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/tickets/${ticketId}/reply`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ message })
        });
        
        if (response.ok) {
            closeTicketModal();
            viewTicketDetails(ticketId);
            loadUserTickets();
        } else {
            const data = await response.json();
            alert(data.detail || 'Failed to send reply');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error sending reply');
    }
}

// Load tickets when navigating to help page
document.addEventListener('DOMContentLoaded', () => {
    // Observer for when help page becomes visible
    const helpPage = document.getElementById('helpPage');
    if (helpPage) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'style' && helpPage.style.display !== 'none') {
                    loadUserTickets();
                }
            });
        });
        observer.observe(helpPage, { attributes: true });
    }
    
    // Observer for when learn page becomes visible
    const learnPage = document.getElementById('learnPage');
    if (learnPage) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'style' && learnPage.style.display !== 'none') {
                    loadLearningVideos();
                }
            });
        });
        observer.observe(learnPage, { attributes: true });
    }
});

// ==================== LEARNING CENTER ====================

let allLearningVideos = [];
let currentVideoFilter = 'all';

async function loadLearningVideos() {
    const grid = document.getElementById('userVideosGrid');
    grid.innerHTML = '<div class="loading-videos">Loading videos...</div>';
    
    try {
        const response = await fetch(`${API_URL}/api/learning/videos`);
        
        if (response.ok) {
            const data = await response.json();
            allLearningVideos = data.videos || [];
            renderLearningVideos(allLearningVideos);
        } else {
            grid.innerHTML = '<div class="no-videos-user"><div class="no-videos-icon-user">📹</div><p>No videos available</p></div>';
        }
    } catch (error) {
        console.error('Error loading videos:', error);
        grid.innerHTML = '<div class="no-videos-user"><div class="no-videos-icon-user">⚠️</div><p>Error loading videos</p></div>';
    }
}

function renderLearningVideos(videos) {
    const grid = document.getElementById('userVideosGrid');
    
    if (!videos || videos.length === 0) {
        grid.innerHTML = `
            <div class="no-videos-user">
                <div class="no-videos-icon-user">📹</div>
                <h3>No Videos Available</h3>
                <p>Check back later for new learning content</p>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = videos.map(video => `
        <div class="user-video-card" onclick="playVideo('${video.youtube_id}', '${escapeHtml(video.title)}', '${escapeHtml(video.description || '')}')">
            <div class="user-video-thumbnail">
                <img src="${video.thumbnail_url}" alt="${escapeHtml(video.title)}" onerror="this.src='https://via.placeholder.com/320x180?text=Video'">
                <div class="user-play-btn">▶</div>
            </div>
            <div class="user-video-info">
                <div class="user-video-title">${escapeHtml(video.title)}</div>
                ${video.description ? `<div class="user-video-desc">${escapeHtml(video.description)}</div>` : ''}
                <span class="user-video-category">${video.category.replace('_', ' ')}</span>
            </div>
        </div>
    `).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function filterVideos(category) {
    currentVideoFilter = category;
    
    // Update active button
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.category === category) {
            btn.classList.add('active');
        }
    });
    
    // Filter and render videos
    if (category === 'all') {
        renderLearningVideos(allLearningVideos);
    } else {
        const filtered = allLearningVideos.filter(v => v.category === category);
        renderLearningVideos(filtered);
    }
}

function playVideo(youtubeId, title, description) {
    const modal = document.getElementById('videoPlayerModal');
    const iframe = document.getElementById('youtubePlayer');
    
    iframe.src = `https://www.youtube.com/embed/${youtubeId}?autoplay=1`;
    document.getElementById('videoPlayerTitle').textContent = title;
    document.getElementById('videoPlayerDesc').textContent = description;
    
    modal.style.display = 'flex';
}

function closeVideoPlayer() {
    const modal = document.getElementById('videoPlayerModal');
    const iframe = document.getElementById('youtubePlayer');
    
    iframe.src = '';
    modal.style.display = 'none';
}
