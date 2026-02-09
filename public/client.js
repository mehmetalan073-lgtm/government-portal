const API = '/api';
let currentUser = null;
let allUsers = [];
let selectedUser = null;

async function login() {
    const u = document.getElementById('login-user').value;
    const p = document.getElementById('login-pass').value;
    if(document.getElementById('login-error')) document.getElementById('login-error').style.display = 'none';

    try {
        const res = await fetch(`${API}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u, password: p })
        });
        const data = await res.json();
        
        if (data.success) {
            currentUser = data.user;
            setupDashboard();
            startHeartbeat(); 
        } else if (data.error === 'banned') {
            startBanTimer(new Date(data.bannedUntil));
        } else {
            alert('Fehler: ' + data.error);
        }
    } catch (e) { console.error(e); alert('Verbindungsproblem!'); }
}

function setupDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';
    document.getElementById('profile-name').innerText = currentUser.fullName;
    document.getElementById('profile-rank').innerText = currentUser.rank;
    document.getElementById('profile-rank').style.backgroundColor = currentUser.color || '#95a5a6';

    const perms = currentUser.permissions || [];
    if (perms.includes('manage_users')) document.getElementById('nav-users').querySelector('.lock').style.display = 'none';
    if (perms.includes('manage_ranks')) document.getElementById('nav-ranks').querySelector('.lock').style.display = 'none';
    switchTab('docs');
}

// --- ONLINE STATUS & KICK CHECK (Alle 2 Sekunden!) ---
function startHeartbeat() {
    setInterval(async () => {
        if(!currentUser) return;
        const res = await fetch(`${API}/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser.username })
        });
        const data = await res.json();
        
        if (data.kicked) {
            // Zeige die Nachricht vom Admin an
            alert(`⛔ DU WURDEST GEKICKT!\n\nVon: ${data.by}\nGrund: ${data.reason}`);
            location.reload(); 
        }
    }, 2000); // 2000ms = 2 Sekunden (sehr schnell)
}

function startBanTimer(endTime) {
    const timerBox = document.getElementById('ban-timer');
    const errBox = document.getElementById('login-error');
    errBox.innerText = "Dieser Account ist gesperrt.";
    errBox.style.display = 'block';

    const interval = setInterval(() => {
        const now = new Date();
        const diff = endTime - now;
        if (diff <= 0) {
            clearInterval(interval);
            timerBox.innerText = "Sperre abgelaufen. Du kannst dich anmelden.";
            timerBox.style.color = "green";
        } else {
            const min = Math.floor((diff / 1000 / 60) % 60);
            const sec = Math.floor((diff / 1000) % 60);
            timerBox.innerText = `Sperre läuft noch: ${min}m ${sec}s`;
        }
    }, 1000);
}

function switchTab(tab) {
    const perms = currentUser.permissions || [];
    if (tab === 'users' && !perms.includes('manage_users')) return;
    if (tab === 'ranks' && !perms.includes('manage_ranks')) return;

    document.querySelectorAll('.tab').forEach(el => el.style.display = 'none');
    document.getElementById(`tab-${tab}`).style.display = 'block';
    if(tab === 'users') loadUsers();
    if(tab === 'ranks') loadRanks();
    if(tab === 'docs') loadDocs();
}

// --- USER & KICK ---
async function loadUsers() {
    const res = await fetch(`${API}/users`);
    allUsers = await res.json();
    const list = document.getElementById('users-list');
    list.innerHTML = allUsers.map(u => {
        const isOnline = (new Date() - new Date(u.last_seen)) < 60000;
        return `<div class="card" onclick="openModal('${u.username}')" style="display:flex; justify-content:space-between;">
            <div><strong>${u.full_name}</strong> <small>(${u.username})</small> <div>${isOnline?'🟢':'⚫'}</div></div>
            <span class="badge" style="background:${u.color||'#ddd'}">${u.rank}</span>
        </div>`;
    }).join('');
}

async function openModal(username) {
    selectedUser = allUsers.find(u => u.username === username);
    document.getElementById('user-modal').style.display = 'flex';
    document.getElementById('modal-username').innerText = username;
    
    // Ranks Dropdown
    const res = await fetch(`${API}/ranks`);
    const ranks = await res.json();
    document.getElementById('modal-rank-select').innerHTML = ranks.map(r => 
        `<option value="${r.name}" ${r.name===selectedUser.rank?'selected':''}>${r.name}</option>`
    ).join('');

    // Kick Rechte prüfen
    if(currentUser.permissions.includes('kick_users')) {
        document.getElementById('kick-section').style.display = 'block';
        document.getElementById('kick-error').style.display = 'none';
    } else {
        document.getElementById('kick-section').style.display = 'none';
        document.getElementById('kick-error').style.display = 'block';
    }
}

function toggleBanInput() {
    const isChecked = document.getElementById('kick-ban-check').checked;
    document.getElementById('ban-duration-box').style.display = isChecked ? 'block' : 'none';
}

async function kickUser() {
    const reason = document.getElementById('kick-reason').value || "Kein Grund";
    const isBan = document.getElementById('kick-ban-check').checked;
    const minutes = document.getElementById('kick-minutes').value;
    
    await fetch(`${API}/users/kick`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ 
            username: selectedUser.username, 
            reason: reason,
            adminName: currentUser.username, // Wir senden den Namen des Admins mit
            isBan: isBan,
            minutes: minutes
        })
    });
    alert('Aktion ausgeführt!');
    closeModal();
    loadUsers();
}

async function saveUserRank() {
    const newRank = document.getElementById('modal-rank-select').value;
    await fetch(`${API}/users/rank`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ username: selectedUser.username, newRank }) });
    alert('Gespeichert'); closeModal(); loadUsers();
}

// --- RÄNGE ---
async function loadRanks() {
    const res = await fetch(`${API}/ranks`);
    const ranks = await res.json();
    document.getElementById('ranks-list-container').innerHTML = ranks.map(r => 
        `<div class="card" style="border-left:5px solid ${r.color}"><strong>${r.name}</strong><br><small>${r.permissions.join(', ')}</small></div>`
    ).join('');
}
async function saveRank() {
    const name = document.getElementById('new-rank-name').value;
    const color = document.getElementById('new-rank-color').value;
    const perms = [];
    if(document.getElementById('perm-docs').checked) perms.push('access_docs');
    if(document.getElementById('perm-users').checked) perms.push('manage_users');
    if(document.getElementById('perm-kick').checked) perms.push('kick_users');
    if(document.getElementById('perm-ranks').checked) perms.push('manage_ranks');
    if(!name) return alert('Name fehlt');
    await fetch(`${API}/ranks`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name, color, permissions: perms }) });
    loadRanks(); alert('Rang gespeichert!');
}

// --- STANDARDS ---
async function loadDocs() {
    const res = await fetch(`${API}/documents`); const docs = await res.json();
    document.getElementById('docs-list').innerHTML = docs.map(d => `<div class="card"><h3>${d.title}</h3><p>${d.content}</p><small>${d.created_by}</small></div>`).join('');
}
async function createDoc() {
    const title = document.getElementById('doc-title').value; const content = document.getElementById('doc-content').value;
    await fetch(`${API}/documents`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ title, content, createdBy: currentUser.username }) }); loadDocs();
}
function closeModal() { document.getElementById('user-modal').style.display = 'none'; }
function showRegister() { document.getElementById('login-screen').style.display = 'none'; document.getElementById('register-screen').style.display = 'flex'; }
function showLogin() { document.getElementById('register-screen').style.display = 'none'; document.getElementById('login-screen').style.display = 'flex'; }
async function register() {
    const data = { username: document.getElementById('reg-user').value, fullName: document.getElementById('reg-name').value, password: document.getElementById('reg-pass').value };
    const res = await fetch(`${API}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) { alert('Registriert!'); showLogin(); }
}
function logout() { location.reload(); }