// app.js

// Run unit tests on load
if (window.runClinicalTests) {
    window.runClinicalTests();
}

// 1. Mock Data Engine (Base Data)
const MOCK_DB = [
    {
        id: "PT-9402",
        mrn: "MRN-847-291",
        name: "Robert Chen",
        age: 68,
        gender: "M",
        status: "STAT",
        statusColor: "bg-red-500/20 text-red-500 border-red-500/30",
        condition: "Severe Aortic Stenosis",
        metrics: { lvef: 35, gls: -9, hr: 92, bp: "145/90" },
        riskScore: "98%",
        confidence: "High",
        confidenceLevel: "high", 
        findings: "AI Segmentation indicates significant calcification of the aortic valve with reduced leaflet excursion. LV systolic dysfunction noted with regional wall motion abnormality in the basal inferolateral wall.",
        aiMaskClass: "mask-danger",
        aiLabel: "Severe Calcification / RWMA"
    },
    {
        id: "PT-1104",
        mrn: "MRN-332-901",
        name: "Jane Smith",
        age: 45,
        gender: "F",
        status: "ROUTINE",
        statusColor: "bg-emerald-500/20 text-emerald-500 border-emerald-500/30",
        condition: "Normal Echo",
        metrics: { lvef: 62, gls: -21, hr: 68, bp: "118/75" },
        riskScore: "12%",
        confidence: "High",
        confidenceLevel: "high",
        findings: "Automated volumetry and strain analysis reveal normal LV/RV size and systolic function. No significant valvular regurgitation or stenosis detected. AI confidence is high based on optimal acoustic windows.",
        aiMaskClass: "mask-normal",
        aiLabel: "Normal Myocardium"
    },
    {
        id: "PT-5521",
        mrn: "MRN-109-445",
        name: "Michael Torres",
        age: 55,
        gender: "M",
        status: "URGENT",
        statusColor: "bg-amber-500/20 text-amber-500 border-amber-500/30",
        condition: "Borderline Ischemia",
        metrics: { lvef: 48, gls: -16, hr: 110, bp: "130/85" }, 
        riskScore: "65%",
        confidence: "Medium",
        confidenceLevel: "medium",
        findings: "Subtle hypokinesis detected in the mid-anterior segment. Model confidence is medium due to image noise in apical 4-chamber view. Human-in-the-loop review strongly recommended to verify border detection.",
        aiMaskClass: "mask-warning",
        aiLabel: "Suspected Hypokinesis (Needs Review)"
    }
];

let patients = [];
let filteredPatients = [];
let selectedPatientId = null;
let isAiOverlayActive = true;
let currentEkgAnimId = null;
const STORAGE_KEY = 'cardiac_ai_patients';

// 2. UI Elements (Cached)
const ui = {
    list: document.getElementById('patient-list'),
    searchInput: document.getElementById('patient-search'),
    ctxName: document.getElementById('ctx-name'),
    ctxMrn: document.getElementById('ctx-mrn'),
    ctxStatus: document.getElementById('ctx-status'),
    ctxDemographics: document.getElementById('ctx-demographics'),
    mLvef: document.getElementById('metric-lvef'),
    mGls: document.getElementById('metric-gls'),
    mHr: document.getElementById('metric-hr'),
    mBp: document.getElementById('metric-bp'),
    score: document.getElementById('confidence-score'),
    scoreLabel: document.getElementById('confidence-label'),
    scoreIndicator: document.getElementById('confidence-indicator'),
    findings: document.getElementById('ai-findings'),
    aiMask: document.getElementById('ai-mask'),
    aiLabel: document.getElementById('ai-label'),
    overlayToggle: document.getElementById('ai-overlay-toggle'),
    loadingState: document.getElementById('app-loading'),
    errorState: document.getElementById('app-error'),
    toastContainer: document.getElementById('toast-container'),
    ekgCanvas: document.getElementById('ekgCanvas'),
    directoryTbody: document.getElementById('directory-tbody'),
    ehrPatientName: document.getElementById('ehr-patient-name')
};

// 3. Initialization & Async Data Loading
async function init() {
    // Restore Theme Preference
    const savedTheme = localStorage.getItem('cardiac_ai_theme');
    const isDark = savedTheme !== 'light';
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) themeToggle.checked = isDark;
    if (isDark) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }

    // Splash Screen Text Cycler
    const splashText = document.getElementById('splash-status-text');
    if (splashText) {
        const phases = [
            "Loading Medical Models...",
            "Establishing Secure FHIR Connection...",
            "CardioKnight AI System Ready"
        ];
        let phaseIdx = 0;
        const textInterval = setInterval(() => {
            splashText.classList.add('opacity-0');
            setTimeout(() => {
                phaseIdx++;
                if (phaseIdx < phases.length) {
                    splashText.textContent = phases[phaseIdx];
                    splashText.classList.remove('opacity-0');
                } else {
                    clearInterval(textInterval);
                }
            }, 300);
        }, 800);
    }

    // Delay init to allow splash animation to play out
    setTimeout(() => {
        checkAuthState();
    }, 2500);

    try {
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Clear cached data on load to purge bad entries
        localStorage.removeItem(STORAGE_KEY);
        
        // Load data from localStorage or fallback to MOCK_DB
        const storedData = localStorage.getItem(STORAGE_KEY);
        if (storedData) {
            patients = JSON.parse(storedData);
        } else {
            patients = [...MOCK_DB];
            savePatients();
        }
        
        filteredPatients = [...patients];
        
        // Hide loading, show content (which defaults to app-content)
        ui.loadingState.classList.add('hidden');
        document.getElementById('app-content').classList.remove('opacity-0');

        renderPatientList();
        renderDirectoryTable();
        
        if (ui.searchInput) {
            ui.searchInput.addEventListener('input', handleSearch);
        }

        if (ui.overlayToggle) {
            ui.overlayToggle.addEventListener('change', (e) => {
                isAiOverlayActive = e.target.checked;
                updateAiOverlay();
            });
        }

        const confidenceSlider = document.getElementById('confidence-slider');
        if (confidenceSlider) {
            confidenceSlider.addEventListener('input', (e) => {
                const valSpan = document.getElementById('threshold-val');
                if (valSpan) valSpan.textContent = e.target.value;
            });
        }

        if (filteredPatients.length > 0) selectPatient(filteredPatients[0].id);

    } catch (error) {
        console.error("Failed to load app data:", error);
        ui.loadingState.classList.add('hidden');
        ui.errorState.classList.remove('hidden');
    }
}

// Data Persistence
function savePatients() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patients));
}

// ==========================================
// USER AUTHENTICATION SYSTEM
// ==========================================
const AUTH_KEY = 'cardio_knight_auth';
const USERS_KEY = 'cardio_knight_users';

function checkAuthState() {
    const splash = document.getElementById('astra-splash');
    const authModal = document.getElementById('auth-modal');
    
    // Always hide splash when done
    if (splash) {
        splash.classList.add('opacity-0');
        setTimeout(() => splash.classList.add('hidden'), 1000);
    }
    
    const activeSession = localStorage.getItem(AUTH_KEY);
    if (!activeSession) {
        // Show Auth Modal
        if (authModal) {
            authModal.classList.remove('hidden');
            setTimeout(() => authModal.classList.remove('opacity-0'), 50);
            window.switchAuthView('login');
        }
    } else {
        // Logged in
        const user = JSON.parse(activeSession);
        document.getElementById('header-dr-name').textContent = user.name;
        document.getElementById('header-dr-title').textContent = user.role;
        
        // Handle Creator UI
        const creatorBadge = document.getElementById('creator-badge');
        const creatorModeNav = document.getElementById('nav-creator-mode');
        const welcomeBanner = document.getElementById('welcome-banner');
        const welcomeBannerText = document.getElementById('welcome-banner-text');
        
        if (user.isCreator) {
            if (creatorBadge) { creatorBadge.classList.remove('hidden'); creatorBadge.classList.add('flex'); }
            if (creatorModeNav) { creatorModeNav.classList.remove('hidden'); creatorModeNav.classList.add('flex'); }
            if (welcomeBanner) welcomeBanner.classList.remove('hidden');
            if (welcomeBannerText) welcomeBannerText.innerHTML = 'Welcome back, Creator Pravati Maitra! 👋 You have full access to alter and control all system settings.';
        } else {
            if (creatorBadge) { creatorBadge.classList.add('hidden'); creatorBadge.classList.remove('flex'); }
            if (creatorModeNav) { creatorModeNav.classList.add('hidden'); creatorModeNav.classList.remove('flex'); }
            if (welcomeBanner) welcomeBanner.classList.remove('hidden');
            if (welcomeBannerText) welcomeBannerText.innerHTML = `Welcome to CardioKnight Workspace, ${user.name}.`;
        }
        
        // Handle Avatar
        const avatarImg = document.getElementById('header-dr-img');
        const savedAvatar = localStorage.getItem('cardioKnight_avatar');
        if (avatarImg) {
            if (savedAvatar) {
                avatarImg.src = savedAvatar;
            } else {
                avatarImg.src = user.isCreator ? "https://i.pravatar.cc/100?img=33" : "https://i.pravatar.cc/100?img=11";
            }
        }
        
        // Hide auth modal if visible
        if (authModal) {
            authModal.classList.add('opacity-0');
            setTimeout(() => authModal.classList.add('hidden'), 500);
        }
    }
}

window.skipSplash = function() {
    checkAuthState();
};

window.switchAuthView = function(view) {
    document.getElementById('auth-login-view').classList.add('hidden');
    document.getElementById('auth-register-view').classList.add('hidden');
    document.getElementById('auth-otp-view').classList.add('hidden');
    document.getElementById('auth-forgot-view').classList.add('hidden');
    
    document.getElementById(`auth-${view}-view`).classList.remove('hidden');
};

let generatedOtp = null;

function handleLogin(e) {
    e.preventDefault();
    const identifier = document.getElementById('login-identifier').value.trim();
    const pass = document.getElementById('login-password').value;
    
    if (!identifier || !pass) {
        showNotification('Login Failed', 'Please provide both email and password.', 'warning');
        return;
    }
    
    let user;
    // CREATOR MASTER PROFILE
    if (identifier === 'pravatim4@gmail.com' || identifier === 'PRAVATI') {
        user = { name: "Pravati Maitra", role: "Creator & Lead Developer", email: "pravatim4@gmail.com", isCreator: true };
        showNotification('Creator Access Granted', `Welcome Creator Pravati Maitra.`, 'success');
    } else {
        // UNIVERSAL ACCESS (Standard User)
        let extractedName = identifier.split('@')[0];
        extractedName = extractedName.charAt(0).toUpperCase() + extractedName.slice(1);
        user = { name: extractedName, role: "Clinical Specialist", email: identifier, isCreator: false };
        showNotification('Welcome Back', `Logged in as ${user.name}`, 'success');
    }
    
    localStorage.setItem(AUTH_KEY, JSON.stringify(user));
    checkAuthState();
}

function showOtpView() {
    const identifier = document.getElementById('login-identifier').value.trim();
    if (!identifier) {
        showNotification('Missing Email', 'Please enter your email to request access.', 'warning');
        return;
    }

    // MASTER DEVELOPER BYPASS
    if (identifier === 'pravatim4@gmail.com' || identifier === 'PRAVATI') {
        const masterUser = { name: "Pravati Maitra", role: "Creator & Lead Developer", email: "pravatim4@gmail.com", isCreator: true };
        localStorage.setItem(AUTH_KEY, JSON.stringify(masterUser));
        checkAuthState();
        showNotification('Creator Access Granted', `Welcome Creator Pravati Maitra.`, 'success');
        return;
    }

    // Generate random 6 digit code
    generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Send email via EmailJS
    emailjs.send("YOUR_SERVICE_ID", "TEMPLATE_OTP", {
        user_email: identifier,
        otp_code: generatedOtp,
        to_email: "pravatim4@gmail.com"
    }).then(
        (response) => {
            console.log('SUCCESS!', response.status, response.text);
            showNotification('Request Sent', `Access Request Sent to Lead Developer.`, 'success');
            window.switchAuthView('otp');
        },
        (error) => {
            console.error('FAILED...', error);
            // Fallback for demo purposes if EmailJS is not configured
            showNotification('Request Simulated', `(Demo) OTP is: ${generatedOtp}`, 'warning');
            window.switchAuthView('otp');
        }
    );
}

function verifyOtp() {
    // Collect 6 digits
    const inputs = document.querySelectorAll('.otp-digit');
    let code = '';
    inputs.forEach(i => code += i.value);
    
    if (code.length === 6 && code === generatedOtp) {
        const user = { name: "Authorized User", role: "External Clinician" };
        localStorage.setItem(AUTH_KEY, JSON.stringify(user));
        checkAuthState();
        showNotification('Access Granted', 'Identity verified.', 'success');
    } else {
        showNotification('Invalid Code', 'Please enter the correct 6-digit code.', 'danger');
    }
}

function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const role = document.getElementById('reg-role').value;
    const email = document.getElementById('reg-email').value.trim();
    
    // Send email via EmailJS for registration request
    emailjs.send("YOUR_SERVICE_ID", "TEMPLATE_REGISTER", {
        user_name: name,
        user_role: role,
        user_email: email,
        to_email: "pravatim4@gmail.com"
    }).then(
        (response) => {
            console.log('SUCCESS!', response.status, response.text);
            showNotification('Request Sent', 'Account request sent for approval.', 'success');
            window.switchAuthView('login');
        },
        (error) => {
            console.error('FAILED...', error);
            showNotification('Request Simulated', `(Demo) Account request for ${name} simulated.`, 'warning');
            window.switchAuthView('login');
        }
    );
}

function handleForgot(e) {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    
    // Send email via EmailJS for password reset
    emailjs.send("YOUR_SERVICE_ID", "TEMPLATE_FORGOT", {
        user_email: email,
        to_email: "pravatim4@gmail.com"
    }).then(
        (response) => {
            console.log('SUCCESS!', response.status, response.text);
            showNotification('Request Sent', 'Password reset request sent to administrator.', 'success');
            window.switchAuthView('login');
        },
        (error) => {
            console.error('FAILED...', error);
            showNotification('Request Simulated', `(Demo) Reset request for ${email} simulated.`, 'warning');
            window.switchAuthView('login');
        }
    );
}

window.logout = function() {
    localStorage.removeItem(AUTH_KEY);
    checkAuthState();
    window.toggleProfileMenu(); // Close dropdown
};

// Bind Event Listeners on Load
document.addEventListener('DOMContentLoaded', () => {
    // Initialize EmailJS
    if (typeof emailjs !== 'undefined') {
        emailjs.init("YOUR_PUBLIC_KEY");
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);

    const registerForm = document.getElementById('register-form');
    if (registerForm) registerForm.addEventListener('submit', handleRegister);

    const forgotForm = document.getElementById('forgot-form');
    if (forgotForm) forgotForm.addEventListener('submit', handleForgot);

    const btnOtpTrigger = document.getElementById('btn-otp-trigger');
    if (btnOtpTrigger) btnOtpTrigger.addEventListener('click', showOtpView);

    const btnVerifyOtp = document.getElementById('btn-verify-otp');
    if (btnVerifyOtp) btnVerifyOtp.addEventListener('click', verifyOtp);

    const btnForgotPassword = document.getElementById('btn-forgot-password');
    if (btnForgotPassword) btnForgotPassword.addEventListener('click', () => window.switchAuthView('forgot'));

    const btnRequestAccess = document.getElementById('btn-request-access');
    if (btnRequestAccess) btnRequestAccess.addEventListener('click', () => window.switchAuthView('register'));
});

// ==========================================

// 4. View Switching Architecture
window.switchView = function(viewId, btnId) {
    // Hide all views
    document.querySelectorAll('.app-view').forEach(view => {
        view.classList.add('hidden');
        view.classList.remove('opacity-0'); // reset opacity for future transitions if needed
    });
    
    // Remove active styles from all nav buttons
    document.querySelectorAll('aside nav button, aside .mt-auto button').forEach(btn => {
        btn.classList.remove('text-white', 'bg-slate-800');
        btn.classList.add('text-slate-400');
    });

    // Show target view
    const targetView = document.getElementById(viewId);
    if(targetView) {
        targetView.classList.remove('hidden');
        // If it's the dashboard, ensure canvas resizes properly
        if(viewId === 'app-content') {
            targetView.classList.remove('opacity-0');
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
            }, 50);
        }
    }

    // Highlight target button
    const targetBtn = document.getElementById(btnId);
    if(targetBtn) {
        targetBtn.classList.add('text-white', 'bg-slate-800');
        targetBtn.classList.remove('text-slate-400');
    }

    // Special logic for directory
    if(viewId === 'view-directory') {
        renderDirectoryTable();
    }
    
    if(viewId === 'view-analytics') {
        renderAnalytics();
    }
};

// 4.5 Render Analytics View
function renderAnalytics() {
    const elTotal = document.getElementById('stat-total');
    const elLvef = document.getElementById('stat-lvef');
    const elHighrisk = document.getElementById('stat-highrisk');
    const elPending = document.getElementById('stat-pending');

    const barStat = document.getElementById('bar-stat');
    const barUrgent = document.getElementById('bar-urgent');
    const barRoutine = document.getElementById('bar-routine');
    
    const pctStat = document.getElementById('pct-stat');
    const pctUrgent = document.getElementById('pct-urgent');
    const pctRoutine = document.getElementById('pct-routine');

    if(!elTotal) return;

    // Calculate Top Metrics
    const total = patients.length;
    let sumLvef = 0;
    let statCount = 0;
    let urgentCount = 0;
    let routineCount = 0;
    let pendingCount = 0;

    patients.forEach(p => {
        sumLvef += p.metrics.lvef;
        if(p.status === 'STAT') statCount++;
        else if(p.status === 'URGENT') urgentCount++;
        else routineCount++; // ROUTINE or COMPLETED

        if(p.status !== 'COMPLETED') pendingCount++;
    });

    const avgLvef = total > 0 ? Math.round(sumLvef / total) : 0;

    elTotal.textContent = total;
    elLvef.textContent = avgLvef + '%';
    elHighrisk.textContent = statCount;
    elPending.textContent = pendingCount;

    // Calculate Distribution Percentages
    let pStat = 0;
    let pUrgent = 0;
    let pRoutine = 0;

    if(total > 0) {
        pStat = Math.round((statCount / total) * 100);
        pUrgent = Math.round((urgentCount / total) * 100);
        pRoutine = 100 - pStat - pUrgent; // ensure 100% total
    }

    // Update CSS bar widths
    barStat.style.width = pStat + '%';
    barUrgent.style.width = pUrgent + '%';
    barRoutine.style.width = pRoutine + '%';

    // Update legends
    pctStat.textContent = pStat + '%';
    pctUrgent.textContent = pUrgent + '%';
    pctRoutine.textContent = pRoutine + '%';
}

// 5. Handle Search
function handleSearch(e) {
    const query = e.target.value.toLowerCase();
    filteredPatients = patients.filter(p => 
        p.name.toLowerCase().includes(query) || 
        p.mrn.toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query)
    );
    renderPatientList();
}

// 6. Render Patient List (Left Sidebar)
function renderPatientList() {
    if(!ui.list) return;
    ui.list.innerHTML = '';
    
    if (filteredPatients.length === 0) {
        ui.list.innerHTML = `<div class="p-4 text-sm text-slate-500 text-center">No patients found.</div>`;
        return;
    }

    filteredPatients.forEach(patient => {
        const item = document.createElement('div');
        item.className = `p-3 md:p-4 border-b border-slate-800 cursor-pointer transition-colors hover:bg-slate-800/50 ${selectedPatientId === patient.id ? 'bg-slate-800/80 border-l-2 border-l-clinical-blue' : 'border-l-2 border-l-transparent'}`;
        item.onclick = () => selectPatient(patient.id);
        
        item.innerHTML = `
            <div class="flex justify-between items-start w-full">
                <div class="flex flex-col space-y-1">
                    <span class="font-bold text-slate-100 text-sm">${patient.name || patient.patientName || patient.fullName || 'Unnamed Patient'}</span>
                    <span class="text-xs text-slate-400 font-mono">${patient.id}</span>
                </div>
                <span class="px-2 py-0.5 rounded text-[8px] md:text-[10px] font-bold border uppercase tracking-wider shrink-0 mt-1 ${patient.statusColor}">${patient.status}</span>
            </div>
        `;
        ui.list.appendChild(item);
    });
}

// 7. Render Directory Table (Full View)
function renderDirectoryTable() {
    if(!ui.directoryTbody) return;
    ui.directoryTbody.innerHTML = '';
    
    patients.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-800/30 transition-colors cursor-pointer';
        tr.onclick = () => {
            selectPatient(p.id);
            window.switchView('app-content', 'nav-dashboard');
        };
        
        tr.innerHTML = `
            <td class="px-6 py-4">
                <div class="font-medium text-slate-200">${p.name}</div>
                <div class="text-[10px] text-slate-500">${p.age} yrs • ${p.gender}</div>
            </td>
            <td class="px-6 py-4 text-slate-400 font-mono text-xs">${p.mrn}</td>
            <td class="px-6 py-4">
                <span class="px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wider ${p.statusColor}">${p.status}</span>
            </td>
            <td class="px-6 py-4 text-slate-400">${p.condition}</td>
            <td class="px-6 py-4 text-right">
                <button class="text-clinical-blue hover:text-white transition-colors"><i data-lucide="chevron-right" class="w-4 h-4 inline-block"></i></button>
            </td>
        `;
        ui.directoryTbody.appendChild(tr);
    });
    if (window.lucide) lucide.createIcons({ root: ui.directoryTbody });
}

// 8. Toast Notification System
window.showNotification = function(title, message, type = 'info') {
    const toast = document.createElement('div');
    
    let colors = 'bg-slate-800 border-clinical-blue text-clinical-blue';
    let icon = 'info';
    
    if (type === 'warning') {
        colors = 'bg-slate-800 border-amber-500 text-amber-500';
        icon = 'alert-triangle';
    } else if (type === 'danger') {
        colors = 'bg-slate-800 border-red-500 text-red-500';
        icon = 'alert-octagon';
    } else if (type === 'success') {
        colors = 'bg-slate-800 border-emerald-500 text-emerald-500';
        icon = 'check-circle';
    }

    toast.className = `border-l-4 rounded shadow-lg p-3 md:p-4 pr-6 flex items-start space-x-3 toast-enter ${colors} max-w-[250px] md:max-w-xs`;
    toast.innerHTML = `
        <i data-lucide="${icon}" class="w-4 h-4 md:w-5 md:h-5 shrink-0 mt-0.5"></i>
        <div>
            <h4 class="font-bold text-xs md:text-sm text-slate-200">${title}</h4>
            <p class="text-[10px] md:text-xs text-slate-400 mt-1">${message}</p>
        </div>
    `;
    
    ui.toastContainer.appendChild(toast);
    if (window.lucide) lucide.createIcons({ root: toast });

    setTimeout(() => {
        toast.classList.remove('toast-enter');
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// 9. Real-time Telemetry Animation (Canvas)
function startEkgAnimation(baseHr) {
    if (currentEkgAnimId) {
        cancelAnimationFrame(currentEkgAnimId);
    }
    
    const canvas = ui.ekgCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const rect = canvas.parentElement.getBoundingClientRect();
    if(rect.width === 0) return; // Hidden view
    
    canvas.width = rect.width;
    canvas.height = rect.height;

    let w = canvas.width;
    let h = canvas.height;
    
    let x = 0;
    let prevY = h/2;
    
    let pxPerFrame = 2 * (baseHr / 60);

    ctx.fillStyle = '#020617'; 
    ctx.fillRect(0, 0, w, h);

    function loop() {
        ctx.fillStyle = 'rgba(2, 6, 23, 0.05)';
        ctx.fillRect(0, 0, w, h);

        ctx.beginPath();
        ctx.moveTo(x, prevY);

        let y = h/2;
        let step = x % (w / 3);

        if (step > 40 && step < 45) y = h/2 - 10;
        else if (step > 55 && step < 60) y = h/2 + 5;
        else if (step > 60 && step < 65) y = h/2 - 40;
        else if (step > 65 && step < 70) y = h/2 + 15;
        else if (step > 90 && step < 100) y = h/2 - 12;

        y += (Math.random() * 2 - 1);

        x += pxPerFrame;
        
        if (x >= w) {
            x = 0;
            ctx.fillStyle = '#020617';
            ctx.fillRect(0, 0, 10, h);
        }

        ctx.lineTo(x, y);
        ctx.strokeStyle = '#10b981'; 
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();

        prevY = y;
        currentEkgAnimId = requestAnimationFrame(loop);
    }
    loop();
}

// 10. Select Patient & Update UI
function selectPatient(id) {
    selectedPatientId = id;
    const p = patients.find(x => x.id === id);
    if (!p) return;

    if (p.condition.toUpperCase().includes('NORMAL') || p.status === 'ROUTINE') {
        p.statusColor = "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
        p.metrics.lvef = 60;
        p.metrics.gls = -20;
        p.metrics.hr = 72;
        p.metrics.bp = "120/80";
        p.aiLabel = "Normal Myocardium";
        p.aiMaskClass = "mask-normal";
    } else if (p.status === 'STAT' || p.condition.toUpperCase().includes('ABNORMAL')) {
        p.statusColor = "bg-rose-500/20 text-rose-400 border-rose-500/30";
        if (p.metrics.lvef > 40) p.metrics.lvef = 31; 
        if (p.metrics.gls > -15) p.metrics.gls = -9;
        p.aiLabel = "Severe Dysfunction";
        p.aiMaskClass = "mask-danger";
    }

    renderPatientList(); 

    if (p.status === 'STAT') {
        showNotification('Critical Patient Selected', `Review STAT case for ${p.name} immediately.`, 'danger');
    } else if (p.metrics.hr > 100) {
        showNotification('Tachycardia Detected', `Patient HR is ${p.metrics.hr} bpm.`, 'warning');
    }

    if(ui.ctxName) ui.ctxName.textContent = p.name;
    if(ui.ctxMrn) ui.ctxMrn.textContent = `MRN: ${p.mrn}`;
    if(ui.ctxStatus) {
        ui.ctxStatus.textContent = p.status;
        ui.ctxStatus.className = `px-2 py-0.5 rounded text-[10px] md:text-xs font-bold border uppercase tracking-wider shrink-0 ${p.statusColor}`;
    }
    if(ui.ctxDemographics) {
        ui.ctxDemographics.innerHTML = `<span>Age: ${p.age}</span><span>Gender: ${p.gender}</span>`;
    }

    let lvefCategory = 'NORMAL';
    let glsCategory = 'NORMAL';
    if (window.ClinicalLogic) {
        lvefCategory = window.ClinicalLogic.evaluateLVEF(p.metrics.lvef);
        glsCategory = window.ClinicalLogic.evaluateGLS(p.metrics.gls);
    }

    const categoryColors = {
        'NORMAL': 'text-emerald-400',
        'BORDERLINE': 'text-amber-400',
        'MODERATE': 'text-orange-400',
        'SEVERE': 'text-red-400',
        'ABNORMAL': 'text-red-400'
    };

    if(ui.mLvef) {
        ui.mLvef.textContent = `${p.metrics.lvef}%`;
        ui.mLvef.className = `text-sm md:text-lg font-bold ${categoryColors[lvefCategory] || 'text-white'}`;
    }
    if(ui.mGls) {
        ui.mGls.textContent = `${p.metrics.gls}%`;
        ui.mGls.className = `text-sm md:text-lg font-bold ${categoryColors[glsCategory] || 'text-white'}`;
    }
    if(ui.mHr) {
        ui.mHr.textContent = `${p.metrics.hr} bpm`;
        ui.mHr.className = `text-sm md:text-lg font-bold ${p.metrics.hr > 100 ? 'text-red-400' : 'text-white'}`;
    }
    if(ui.mBp) ui.mBp.textContent = p.metrics.bp;

    startEkgAnimation(p.metrics.hr);
    
    // Sync heartbeat pulse animation duration
    if (p.metrics.hr > 0) {
        const duration = 60 / p.metrics.hr;
        const heartIcon = document.getElementById('heart-icon');
        if (heartIcon) heartIcon.style.animationDuration = `${duration}s`;
    }

    if(ui.findings) ui.findings.textContent = p.findings;
    
    let computedScore = p.riskScore;
    if (p.confidenceLevel === 'high' || p.confidence === 'High') {
        computedScore = (Math.floor(Math.random() * (98 - 92 + 1)) + 92) + "%";
    }
    if(ui.score) ui.score.textContent = computedScore;
    
    let confidenceColor = 'bg-slate-700'; 
    if (p.confidenceLevel === 'high') {
        confidenceColor = 'bg-emerald-500';
        if(ui.scoreLabel) {
            ui.scoreLabel.textContent = `Diagnostic Match: ${p.confidence}`;
            ui.scoreLabel.className = "text-xs md:text-sm pb-1 text-emerald-400";
        }
    } else if (p.confidenceLevel === 'medium') {
        confidenceColor = 'bg-amber-500';
        if(ui.scoreLabel) {
            ui.scoreLabel.textContent = `Match: ${p.confidence} (Review Req.)`;
            ui.scoreLabel.className = "text-xs md:text-sm pb-1 text-amber-400";
        }
    } else {
        confidenceColor = 'bg-red-500';
        if(ui.scoreLabel) {
            ui.scoreLabel.textContent = `Match: ${p.confidence} (Low Sig.)`;
            ui.scoreLabel.className = "text-xs md:text-sm pb-1 text-red-400";
        }
    }
    
    if(ui.scoreIndicator) ui.scoreIndicator.className = `absolute top-0 right-0 w-1 h-full transition-colors duration-300 ${confidenceColor}`;

    updateAiOverlay(p);
}

// 11. Handle AI Overlay Toggle
function updateAiOverlay(patientData = null) {
    const p = patientData || patients.find(x => x.id === selectedPatientId);
    if (!p || !ui.aiMask || !ui.aiLabel) return;

    ui.aiMask.className = `absolute inset-0 rounded-full border-[3px] border-transparent transition-all duration-300 pointer-events-none`;
    ui.aiLabel.classList.add('hidden');
    
    const normalRoi = document.querySelector('.roi-normal');
    const abnormalRois = document.querySelectorAll('.roi-abnormal');

    if (isAiOverlayActive) {
        setTimeout(() => {
            ui.aiMask.className = `absolute inset-0 rounded-full border-[3px] transition-all duration-500 pointer-events-none mask-active ${p.aiMaskClass}`;
            ui.aiLabel.textContent = p.aiLabel;
            ui.aiLabel.classList.remove('hidden');
            
            if (p.status === 'ROUTINE' || p.condition.toUpperCase().includes('NORMAL')) {
                if(normalRoi) normalRoi.classList.remove('hidden');
                abnormalRois.forEach(r => r.classList.add('hidden'));
            } else {
                if(normalRoi) normalRoi.classList.add('hidden');
                abnormalRois.forEach(r => r.classList.remove('hidden'));
            }
        }, 50);
    } else {
        if(normalRoi) normalRoi.classList.add('hidden');
        abnormalRois.forEach(r => r.classList.add('hidden'));
    }
}

// ==========================================
// MODALS & NEW FEATURES
// ==========================================

// Register Patient Form Handler
window.openRegisterModal = function() {
    const el = document.getElementById('register-modal');
    const content = document.getElementById('register-modal-content');
    if(!el) return;
    el.classList.remove('hidden');
    setTimeout(() => {
        el.classList.remove('opacity-0');
        content.classList.remove('scale-95');
    }, 10);
};

window.closeRegisterModal = function() {
    const el = document.getElementById('register-modal');
    const content = document.getElementById('register-modal-content');
    if(!el) return;
    el.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(() => {
        el.classList.add('hidden');
        document.getElementById('register-form').reset();
    }, 300);
};

window.handleRegistrationSubmit = function(e) {
    e.preventDefault();
    
    // Grab values
    const inputName = document.getElementById('patient-name')?.value ||   
                      document.getElementById('patientName')?.value ||   
                      document.querySelector('input[name="name"]')?.value ||
                      document.getElementById('reg-name')?.value || '';  
                      
    const nameVal = inputName.trim() || 'Patient ' + Math.floor(100 + Math.random() * 900);
    const mrn = document.getElementById('reg-mrn').value;
    const age = document.getElementById('reg-age').value;
    const gender = document.getElementById('reg-gender').value;
    const priority = document.getElementById('reg-priority').value;
    const lvef = parseInt(document.getElementById('reg-lvef').value);
    const hr = parseInt(document.getElementById('reg-hr').value);
    const condition = document.getElementById('reg-condition').value;

    // Determine Status color & Mock logic based on inputs
    let statusColor = "bg-emerald-500/20 text-emerald-500 border-emerald-500/30";
    if(priority === 'STAT') statusColor = "bg-red-500/20 text-red-500 border-red-500/30";
    if(priority === 'URGENT') statusColor = "bg-amber-500/20 text-amber-500 border-amber-500/30";

    // Randomize some mock metrics based on severity
    const gls = lvef < 45 ? -10 : -19;
    const bpSystolic = priority === 'STAT' ? 160 : 120;
    const bpDiastolic = priority === 'STAT' ? 100 : 80;

    let aiMaskClass = 'mask-normal';
    let aiLabel = 'Normal Limits';
    let confidenceLevel = 'high';
    if(lvef < 40) {
        aiMaskClass = 'mask-danger';
        aiLabel = 'Severe Dysfunction';
        confidenceLevel = 'high';
    } else if (lvef < 50) {
        aiMaskClass = 'mask-warning';
        aiLabel = 'Suspected Anomaly';
        confidenceLevel = 'medium';
    }

    const newPatient = {
        id: `PT-${Math.floor(Math.random() * 9000) + 1000}`,
        mrn: mrn,
        name: nameVal,
        patientName: nameVal,
        fullName: nameVal,
        age: parseInt(age),
        gender: gender,
        status: priority,
        statusColor: statusColor,
        condition: condition,
        metrics: { lvef: lvef, gls: gls, hr: hr, bp: `${bpSystolic}/${bpDiastolic}` },
        riskScore: lvef < 40 ? "85%" : "25%",
        confidence: "Medium",
        confidenceLevel: confidenceLevel,
        findings: `AI generated findings for new patient based on provided vitals. LVEF is ${lvef}%. Proceed with clinical protocol for ${condition}.`,
        aiMaskClass: aiMaskClass,
        aiLabel: aiLabel
    };

    // Add to DB and storage
    patients.unshift(newPatient); // add to top
    filteredPatients = [...patients];
    savePatients();

    // UI Updates
    closeRegisterModal();
    selectPatient(newPatient.id);
    showNotification('Patient Registered', `${name} has been added to the system.`, 'success');
    
    // Switch view if we are on directory
    window.switchView('app-content', 'nav-dashboard');
};

// Sign-Off Logic
window.openSignOffModal = function() {
    const p = patients.find(x => x.id === selectedPatientId);
    if (!p) return;
    
    if(p.status === 'COMPLETED') {
        showNotification('Already Signed Off', 'This chart is already finalized.', 'warning');
        return;
    }

    const el = document.getElementById('signoff-modal');
    const content = document.getElementById('signoff-modal-content');
    el.classList.remove('hidden');
    setTimeout(() => {
        el.classList.remove('opacity-0');
        content.classList.remove('scale-95');
    }, 10);
};

window.closeSignOffModal = function() {
    const el = document.getElementById('signoff-modal');
    const content = document.getElementById('signoff-modal-content');
    el.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(() => { el.classList.add('hidden'); }, 300);
};

window.confirmSignOff = function() {
    const p = patients.find(x => x.id === selectedPatientId);
    if (!p) return;

    p.status = 'COMPLETED';
    p.statusColor = "bg-green-500/20 text-green-500 border-green-500/30";
    savePatients();
    
    renderPatientList();
    renderDirectoryTable();
    
    if(ui.ctxStatus) {
        ui.ctxStatus.textContent = p.status;
        ui.ctxStatus.className = `px-2 py-0.5 rounded text-[10px] md:text-xs font-bold border uppercase tracking-wider shrink-0 ${p.statusColor}`;
    }

    closeSignOffModal();
    showNotification('Report Signed', 'Diagnostic findings finalized and chart completed.', 'success');
};

// EHR Drawer Logic
window.openEhrDrawer = function() {
    const overlay = document.getElementById('ehr-drawer-overlay');
    const drawer = document.getElementById('ehr-drawer');
    const p = patients.find(x => x.id === selectedPatientId);
    if(p && ui.ehrPatientName) {
        ui.ehrPatientName.textContent = `${p.name} (${p.mrn})`;
    }

    overlay.classList.remove('hidden');
    drawer.classList.remove('hidden');
    
    setTimeout(() => {
        overlay.classList.remove('opacity-0');
        drawer.classList.remove('translate-x-full');
    }, 10);
};

window.closeEhrDrawer = function() {
    const overlay = document.getElementById('ehr-drawer-overlay');
    const drawer = document.getElementById('ehr-drawer');
    
    overlay.classList.add('opacity-0');
    drawer.classList.add('translate-x-full');
    
    setTimeout(() => {
        overlay.classList.add('hidden');
        drawer.classList.add('hidden');
    }, 300);
};

// ----------------------------------------------------
// EHR Interactive Forms
// ----------------------------------------------------

window.toggleConditionForm = function() {
    const form = document.getElementById('ehr-add-condition-form');
    form.classList.toggle('hidden');
};

window.addCondition = function() {
    const input = document.getElementById('ehr-new-condition');
    const val = input.value.trim();
    if(val) {
        const list = document.getElementById('ehr-conditions-list');
        const li = document.createElement('li');
        li.textContent = val;
        list.appendChild(li);
        input.value = '';
        window.toggleConditionForm();
        showNotification('Condition Added', `Added ${val} to Medical History.`, 'success');
    }
};

window.toggleMedForm = function() {
    const form = document.getElementById('ehr-add-med-form');
    form.classList.toggle('hidden');
};

window.addMedication = function() {
    const medInput = document.getElementById('ehr-new-med');
    const doseInput = document.getElementById('ehr-new-dosage');
    const med = medInput.value.trim();
    const dose = doseInput.value.trim();
    
    if(med && dose) {
        const list = document.getElementById('ehr-meds-list');
        const div = document.createElement('div');
        div.className = 'bg-slate-950 border border-slate-800 p-2 rounded text-sm animate-fade-in';
        div.innerHTML = `<div class="text-slate-200">${med} <span class="text-slate-500 ml-1">${dose}</span></div>`;
        list.appendChild(div);
        
        medInput.value = '';
        doseInput.value = '';
        window.toggleMedForm();
        showNotification('Medication Added', `Added ${med} to Active Medications.`, 'success');
        
        // Mock AI Interaction Warning
        if(med.toLowerCase().includes('warfarin') || med.toLowerCase().includes('amiodarone') || med.toLowerCase().includes('nsaid')) {
            const warning = document.getElementById('ehr-ai-warning');
            const warningText = document.getElementById('ehr-ai-warning-text');
            warningText.textContent = `Potential interaction detected between ${med} and existing regimen. Review closely.`;
            warning.classList.remove('hidden');
        }
    }
};

window.toggleLabsForm = function() {
    const form = document.getElementById('ehr-update-labs-form');
    form.classList.toggle('hidden');
    
    // Pre-fill
    if(!form.classList.contains('hidden')) {
        document.getElementById('ehr-upd-ldl').value = document.getElementById('lab-val-ldl').textContent;
        document.getElementById('ehr-upd-a1c').value = document.getElementById('lab-val-a1c').textContent;
        document.getElementById('ehr-upd-creatinine').value = document.getElementById('lab-val-creatinine').textContent;
        document.getElementById('ehr-upd-troponin').value = document.getElementById('lab-val-troponin').textContent;
    }
};

window.updateLabs = function() {
    document.getElementById('lab-val-ldl').textContent = document.getElementById('ehr-upd-ldl').value;
    document.getElementById('lab-val-a1c').textContent = document.getElementById('ehr-upd-a1c').value;
    document.getElementById('lab-val-creatinine').textContent = document.getElementById('ehr-upd-creatinine').value;
    document.getElementById('lab-val-troponin').textContent = document.getElementById('ehr-upd-troponin').value;
    
    window.toggleLabsForm();
    showNotification('Labs Updated', 'Lab values updated successfully.', 'success');
    
    // Update AI Summary based on new troponin
    const aiSummary = document.getElementById('ehr-ai-summary');
    const trop = document.getElementById('ehr-upd-troponin').value;
    if(trop.includes('>') || parseFloat(trop) > 0.04) {
        aiSummary.textContent = `CRITICAL: Elevated Troponin levels detected. High risk of myocardial injury. Immediate intervention required.`;
        aiSummary.className = 'text-red-400 font-medium';
    } else {
        aiSummary.textContent = `Troponin levels normal; Glycemic control stable. Patient is compliant with active medications. Follow-up recommended in 6 months for lipid panel reassessment.`;
        aiSummary.className = '';
    }
};

// Global escape key listener
document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') {
        const ehrDrawer = document.getElementById('ehr-drawer');
        const regModal = document.getElementById('register-modal');
        const signOffModal = document.getElementById('signoff-modal');
        const aiModal = document.getElementById('ai-analysis-modal');
        
        if(ehrDrawer && !ehrDrawer.classList.contains('hidden')) window.closeEhrDrawer();
        if(regModal && !regModal.classList.contains('hidden')) window.closeRegisterModal();
        if(signOffModal && !signOffModal.classList.contains('hidden')) window.closeSignOffModal();
        if(aiModal && !aiModal.classList.contains('hidden')) window.closeAiAnalysisModal();
    }
});

// Ingestion Upload Simulator & File Handler
window.triggerFileInput = function() {
    document.getElementById('actual-file-input').click();
};

window.handleFileSelect = function(event) {
    const files = event.target.files;
    if (files.length > 0) {
        processFiles(Array.from(files));
    }
    event.target.value = ''; // reset
};

// Setup Drag and Drop
document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('upload-dropzone');
    if (dropzone) {
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('border-clinical-blue', 'bg-slate-800/80');
        });
        dropzone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropzone.classList.remove('border-clinical-blue', 'bg-slate-800/80');
        });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('border-clinical-blue', 'bg-slate-800/80');
            if (e.dataTransfer.files.length > 0) {
                processFiles(Array.from(e.dataTransfer.files));
            }
        });
    }
});

function processFiles(files) {
    if(files.length === 0) return;
    
    // Process the first file sequentially for UI purposes
    const file = files[0];
    
    const overlay = document.getElementById('upload-progress-overlay');
    const bar = document.getElementById('upload-progress-bar');
    const text = document.getElementById('upload-progress-text');
    
    overlay.classList.remove('hidden');
    bar.style.width = '0%';
    text.textContent = `Analyzing ${file.name}...`;
    
    // Read thumbnail if image
    let dataUrl = null;
    if (file.type.startsWith('image/') || file.name.endsWith('.png') || file.name.endsWith('.jpg') || file.name.endsWith('.jpeg')) {
        const reader = new FileReader();
        reader.onload = (e) => dataUrl = e.target.result;
        reader.readAsDataURL(file);
    }
    
    // Total 1.5 seconds animation
    let progress = 0;
    const interval = setInterval(() => {
        progress += 10;
        if(progress > 100) progress = 100;
        
        bar.style.width = `${progress}%`;
        
        if(progress > 30 && progress < 60) text.textContent = "Extracting Metadata & Features...";
        else if(progress >= 60 && progress < 90) text.textContent = "Running AI Inference...";
        
        if(progress === 100) {
            clearInterval(interval);
            text.textContent = "Complete!";
            setTimeout(() => {
                overlay.classList.add('hidden');
                
                // Show Success Notification
                showNotification('Ingestion Complete', `File '${file.name}' successfully ingested and analyzed by CardioKnight AI.`, 'success');
                
                // Append to Recent Uploads
                appendRecentUpload(file, dataUrl);
                
                // If there are more files, could process next, but let's just do one for now
            }, 500); // Wait 0.5s at 100% before closing
        }
    }, 150); // 10 steps of 150ms = 1.5s
}

function appendRecentUpload(file, dataUrl) {
    const list = document.getElementById('recent-uploads-list');
    
    const div = document.createElement('div');
    div.className = 'bg-slate-900 border border-slate-800 rounded p-3 flex justify-between items-center text-sm cursor-pointer hover:bg-slate-800 transition-colors animate-fade-in';
    
    // Determine icon based on extension/type
    let iconName = 'file';
    let iconColor = 'text-slate-400';
    if(file.name.endsWith('.pdf')) {
        iconName = 'file-text';
        iconColor = 'text-red-400';
    } else if(file.name.endsWith('.json')) {
        iconName = 'file-json';
        iconColor = 'text-yellow-400';
    } else if(file.name.endsWith('.dcm')) {
        iconName = 'file-archive';
        iconColor = 'text-emerald-500';
    } else if(file.type.startsWith('image/')) {
        iconName = 'image';
        iconColor = 'text-blue-400';
    }

    div.innerHTML = `
        <div class="flex items-center truncate mr-2">
            <i data-lucide="${iconName}" class="w-4 h-4 ${iconColor} mr-2 shrink-0"></i> 
            <span class="truncate">${file.name}</span>
        </div>
        <span class="bg-emerald-500/10 text-emerald-500 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider shrink-0">Processed</span>
    `;
    
    div.onclick = () => {
        window.openAiAnalysisModal(file.name, dataUrl, file);
    };

    list.insertBefore(div, list.firstChild);
    if(window.lucide) lucide.createIcons({ root: div });
    showNotification('Ingestion Complete', `File '${file.name}' successfully ingested and analyzed.`, 'success');
}

// ----------------------------------------------------
// AI Analysis Modal
// ----------------------------------------------------
window.openAiAnalysisModal = function(filename, dataUrl) {
    const modal = document.getElementById('ai-analysis-modal');
    const content = document.getElementById('ai-analysis-modal-content');
    
    document.getElementById('ai-modal-filename').textContent = `— ${filename}`;
    
    const imgEl = document.getElementById('ai-modal-img');
    const iconEl = document.getElementById('ai-modal-icon');
    
    if (dataUrl) {
        imgEl.src = dataUrl;
        imgEl.classList.remove('hidden');
        iconEl.classList.add('hidden', 'flex-col');
    } else {
        imgEl.classList.add('hidden');
        iconEl.classList.remove('hidden');
        iconEl.classList.add('flex', 'flex-col');
        // change icon based on file type
        const iconElement = iconEl.querySelector('i');
        if (filename.endsWith('.json')) {
            iconElement.setAttribute('data-lucide', 'file-json');
            iconEl.querySelector('span').textContent = 'JSON Data Preview';
        } else if (filename.endsWith('.pdf')) {
            iconElement.setAttribute('data-lucide', 'file-text');
            iconEl.querySelector('span').textContent = 'PDF Document Preview';
        } else {
            iconElement.setAttribute('data-lucide', 'file');
            iconEl.querySelector('span').textContent = 'DICOM Metadata Preview';
        }
        if(window.lucide) lucide.createIcons();
    }
    
    // Set dynamic mock observations based on filename (just to look smart)
    const impressionEl = document.getElementById('ai-modal-impression');
    const confidenceEl = document.getElementById('ai-modal-confidence');
    
    if (filename.toLowerCase().includes('normal')) {
        impressionEl.textContent = 'Normal Cardiac Function / No Acute Findings';
        confidenceEl.textContent = '98% Match';
        confidenceEl.className = 'bg-emerald-500 text-white text-xs px-2 py-1 rounded font-bold';
    } else {
        impressionEl.textContent = 'Borderline Ischemia / Wall Motion Abnormality';
        confidenceEl.textContent = '91% Match';
        confidenceEl.className = 'bg-clinical-blue text-white text-xs px-2 py-1 rounded font-bold';
    }
    
    modal.classList.remove('hidden');
    // Trigger reflow
    void modal.offsetWidth;
    modal.classList.remove('opacity-0');
    content.classList.remove('scale-95');
};

window.closeAiAnalysisModal = function() {
    const modal = document.getElementById('ai-analysis-modal');
    const content = document.getElementById('ai-analysis-modal-content');
    
    modal.classList.add('opacity-0');
    content.classList.add('scale-95');
    
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
};

window.sendReportToEHR = function() {
    showNotification('Report Sent', 'The AI diagnostic findings have been linked to the active patient\'s EHR record.', 'success');
    window.closeAiAnalysisModal();
};

window.downloadPdfReport = function() {
    showNotification('Download Started', 'The PDF summary report is downloading.', 'info');
};

// Handle window resize for canvas
window.addEventListener('resize', () => {
    if (selectedPatientId) {
        const p = patients.find(x => x.id === selectedPatientId);
        if (p) startEkgAnimation(p.metrics.hr);
    }
});

// Run app
document.addEventListener('DOMContentLoaded', () => {
    init();
    
    // Avatar upload listener
    const avatarInput = document.getElementById('avatar-upload');
    if (avatarInput) {
        avatarInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    const base64Str = event.target.result;
                    localStorage.setItem('cardioKnight_avatar', base64Str);
                    document.getElementById('header-dr-img').src = base64Str;
                    showNotification('Profile Updated', 'Your profile photo has been updated successfully.', 'success');
                };
                reader.readAsDataURL(file);
            }
        });
    }
});

// ----------------------------------------------------
// UI Enhancements (Profiles, Animation Toggle)
// ----------------------------------------------------

window.toggleProfileMenu = function() {
    const menu = document.getElementById('profile-dropdown');
    if (menu) menu.classList.toggle('hidden');
};

const doctors = {
    reynolds: { name: 'Dr. S. Reynolds', title: 'Chief of Cardiology', img: 'https://i.pravatar.cc/100?img=33' },
    vance: { name: 'Dr. A. Vance', title: 'Senior Radiologist', img: 'https://i.pravatar.cc/100?img=47' },
    patel: { name: 'Dr. M. Patel', title: 'Interventional Cardiologist', img: 'https://i.pravatar.cc/100?img=11' }
};

window.switchDoctorProfile = function(id) {
    const doc = doctors[id];
    if(doc) {
        document.getElementById('header-dr-name').textContent = doc.name;
        document.getElementById('header-dr-title').textContent = doc.title;
        document.getElementById('header-dr-img').src = doc.img;
        
        const signoffName = document.getElementById('signoff-dr-name');
        if(signoffName) signoffName.textContent = doc.name;
        
        showNotification('Profile Switched', `Now acting as ${doc.name}`, 'info');
    }
    window.toggleProfileMenu();
};

let echoPlaying = true;
window.toggleEchoPlayback = function() {
    echoPlaying = !echoPlaying;
    const btn = document.getElementById('echo-play-btn');
    const heart = document.getElementById('heart-icon');
    const radar = document.getElementById('radar-sweep');
    
    if (echoPlaying) {
        btn.innerHTML = '<i data-lucide="pause-circle" class="w-4 h-4 mr-1"></i><span class="hidden md:inline">Real-Time Echo</span>';
        if (heart) heart.style.animationPlayState = 'running';
        if (radar) radar.style.animationPlayState = 'running';
    } else {
        btn.innerHTML = '<i data-lucide="play-circle" class="w-4 h-4 mr-1 text-slate-400"></i><span class="hidden md:inline text-slate-400">Paused</span>';
        if (heart) heart.style.animationPlayState = 'paused';
        if (radar) radar.style.animationPlayState = 'paused';
    }
    if (window.lucide) lucide.createIcons({ root: btn });
};

window.toggleTheme = function(isDark) {
    if (isDark) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('cardiac_ai_theme', 'dark');
        showNotification('Theme Changed', 'Dark Mode enabled.', 'info');
    } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('cardiac_ai_theme', 'light');
        showNotification('Theme Changed', 'Light Mode enabled.', 'info');
    }
};

window.wipeDatabase = function() {
    localStorage.removeItem(STORAGE_KEY);
    patients = [];
    filteredPatients = [];
    renderPatientList();
    renderDirectoryTable();
    showNotification('Database Wiped', 'Local storage cache cleared.', 'danger');
};

window.repopulateMockData = function() {
    patients = [...MOCK_DB];
    filteredPatients = [...patients];
    savePatients();
    renderPatientList();
    renderDirectoryTable();
    showNotification('Database Reset', 'Default mock data populated.', 'success');
};

window.toggleTelemetry = function(isActive) {
    const canvas = document.getElementById('ekgCanvas');
    if (isActive) {
        if (canvas) canvas.style.opacity = '1';
        if (selectedPatientId) {
            const p = patients.find(x => x.id === selectedPatientId);
            if (p) startEkgAnimation(p.metrics.hr);
        }
        showNotification('Telemetry Active', 'Simulated telemetry enabled.', 'info');
    } else {
        if (canvas) canvas.style.opacity = '0';
        if (currentEkgAnimId) {
            cancelAnimationFrame(currentEkgAnimId);
            currentEkgAnimId = null;
        }
        showNotification('Telemetry Paused', 'Simulated telemetry disabled.', 'warning');
    }
};

window.closeSplash = function() {
    const splash = document.getElementById('astra-splash');
    if (splash) {
        splash.classList.add('opacity-0');
        setTimeout(() => splash.remove(), 500);
    }
};

window.logout = function() {
    localStorage.removeItem(AUTH_KEY);
    // Optionally remove avatar on logout or keep it for the device
    // localStorage.removeItem('cardioKnight_avatar');
    showNotification('Logged Out', 'You have successfully logged out.', 'info');
    document.getElementById('profile-dropdown')?.classList.add('hidden');
    checkAuthState();
};
