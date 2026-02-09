const API = '/api';
let currentUser = null;
let allUsers = []; // Für Suche
let selectedUser = null; // Für Modal

// --- LOGIN & COUNTDOWN ---

async function login() {
    const u = document.getElementById('login-user').value;
    const p = document.getElementById('login-pass').value;
    const errBox = document.getElementById('login-error');
    const timerBox = document.getElementById('ban-timer');

    errBox.style.display = 'none';
    timerBox.innerText = '';

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
            startHeartbeat(); // Startet "Ich bin online" Signal
        } else if (data.error === 'banned') {
            // LIVE TIMER STARTEN
            startBanTimer(new Date(data.bannedUntil));
        } else {
            alert('Fehler: ' + data.error);
        }
    } catch (e) { alert('Verbindungsproblem'); }
}

let banInterval;
function startBanTimer(endTime) {
    const timerBox = document.getElementById('ban-timer');
    document.getElementById('login-error').innerText = "⛔ DU WURDEST GEKICKT!";
    document.getElementById('login-error').style.display = 'block';

    if(banInterval) clearInterval(banInterval);

    banInterval = setInterval(() => {
        const now = new Date();
        const diff = endTime - now;

        if (diff <= 0) {
            clearInterval(banInterval);
            timerBox.innerText = "Sperre abgelaufen. Bitte neu anmelden.";
            timerBox.style.color = "green";
        } else {
            const min = Math.floor((diff / 1000 / 60) % 60);
            const sec = Math.floor((diff / 1000) % 60);
            timerBox.innerText = `Login möglich in: ${min}m ${sec}s`;
        }
    }, 1000);
}

// --- DASHBOARD & SIDEBAR ---

function setupDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';

    document.getElementById('profile-name').innerText = currentUser.fullName;
    document.getElementById('profile-rank').innerText = currentUser.rank;
    document.getElementById('profile-rank').style.backgroundColor = currentUser.color || '#95a5a6';

    const perms = currentUser.permissions || [];
    
    // Sidebar Logik: Schloss entfernen wenn Recht da ist
    setupSidebarButton('nav-users', 'manage_users', perms);
    setupSidebarButton('nav-ranks', 'manage_ranks', perms);

    // Default Tab
    switchTab('docs');
}

function setupSidebarButton(id, perm, userPerms) {
    const btn = document.getElementById(id);
    const lock = btn.querySelector('.lock-icon');
    
    if (userPerms.includes(perm)) {
        btn.classList.remove('disabled');
        lock.style.display = 'none';
        btn.disabled = false;
    } else {
        btn.classList.add('disabled');
        lock.style.display = 'inline';
        // Klick Event entfernen wir nicht hart, sondern prüfen in switchTab
    }
}

function switchTab(tabName) {
    const perms = currentUser.permissions || [];
    
    // Sicherheitscheck beim Klicken
    if (tabName === 'users' && !perms.includes('manage_users')) return;
    if (tabName === 'ranks' && !perms.includes('manage_ranks')) return;

    document.querySelectorAll('.tab').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-links button').forEach(b => b.classList.remove('active'));
    
    document.getElementById(`tab-${tabName}`).style.display = 'block';
    // Button aktiv setzen (Achtung ID Mapping)
    const navId = 'nav-' + tabName;
    if(document.getElementById(navId)) document.getElementById(navId).classList.add('active');

    if(tabName === 'users') {
        loadUsers(); 
        // Starte Live-Refresh für User Liste
        if(window.userRefresh) clearInterval(window.userRefresh);
        window.userRefresh = setInterval(loadUsers, 5000); // Alle 5 Sek update
    } else {
        if(window.userRefresh) clearInterval(window.userRefresh);
    }
    
    if(tabName === 'ranks') loadRanks();
    if(tabName === 'docs') loadDocs();
}

// --- PERSONAL (USERS) ---

async function loadUsers() {
    const res = await fetch(`${API}/users`);
    allUsers = await res.json();
    filterUsers(); // Rendern
}

function filterUsers() {
    const term = document.getElementById('user-search').value.toLowerCase();
    const list = document.getElementById('users-list');
    
    const filtered = allUsers.filter(u => 
        u.username.toLowerCase().includes(term) || 
        u.full_name.toLowerCase().includes(term)
    );

    list.innerHTML = filtered.map(u => {
        // Online Status prüfen (innerhalb der letzten 60 sekunden)
        const lastSeen = u.last_seen ? new Date(u.last_seen) : new Date(0);
        const isOnline = (new Date() - lastSeen) < 60000; 
        const statusDot = isOnline ? '🟢 Online' : 'Vm⚫ Offline';
        const statusColor = isOnline ? '#2ecc71' : '#95a5a6';

        return `
        <div class="card user-card" onclick="openUserModal('${u.username}')">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <strong>${u.full_name}</strong> <small>(${u.username})</small>
                    <div style="color:${statusColor}; font-size:0.8em; margin-top:2px;">${statusDot}</div>
                </div>
                <span style="background:${u.color || '#ddd'}; color:white; padding:4px 10px; border-radius:12px;">${u.rank}</span>
            </div>
        </div>
        `;
    }).join('');
}

// MODAL LOGIK
async function openUserModal(username) {
    selectedUser = allUsers.find(u => u.username === username);
    document.getElementById('user-modal').style.display = 'flex';
    document.getElementById('modal-username').innerText = `${selectedUser.full_name} verwalten`;

    // Ranks für Dropdown laden
    const res = await fetch(`${API}/ranks`);
    const ranks = await res.json();
    const select = document.getElementById('modal-rank-select');
    select.innerHTML = ranks.map(r => `<option value="${r.name}" ${r.name === selectedUser.rank ? 'selected' : ''}>${r.name}</option>`).join('');

    // Kick Button prüfen
    if (currentUser.permissions.includes('kick_users')) {
        document.getElementById('kick-section').style.display = 'block';
        document.getElementById('kick-error').style.display = 'none';
    } else {
        document.getElementById('kick-section').style.display = 'none';
        document.getElementById('kick-error').style.display = 'block';
    }
}

function closeModal() { document.getElementById('user-modal').style.display = 'none'; }

async function saveUserRank() {
    const newRank = document.getElementById('modal-rank-select').value;
    await fetch(`${API}/users/rank`, { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username: selectedUser.username, newRank })
    });
    alert('Rang geändert!');
    loadUsers();
    closeModal();
}

async function kickUser() {
    const min = document.getElementById('kick-minutes').value;
    await fetch(`${API}/users/kick`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username: selectedUser.username, minutes: min })
    });
    alert(`${selectedUser.username} wurde für ${min} Minuten gekickt!`);
    closeModal();
}

// --- HEARTBEAT (Online Status) ---
function startHeartbeat() {
    setInterval(async () => {
        if(!currentUser) return;
        const res = await fetch(`${API}/heartbeat`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username: currentUser.username })
        });
        const data = await res.json();
        
        // Wenn ich gekickt wurde:
        if (data.kicked) {
            alert(`Du wurdest GEKICKT!\nSperre bis: ${new Date(data.bannedUntil).toLocaleTimeString()}`);
            location.reload(); // Logout erzwingen
        }
    }, 10000); // Alle 10 sekunden
}

// --- REST (Akten, Ränge speichern etc) ---
// (Hier kopiere ich die Standardfunktionen rein, damit die Datei komplett ist)

async function loadDocs() {
    const res = await fetch(`${API}/documents`);
    const docs = await res.json();
    document.getElementById('docs-list').innerHTML = docs.map(d => `<div class="card"><h3>${d.title}</h3><p>${d.content}</p><small>Von: ${d.created_by}</small></div>`).join('');
}
async function createDoc() {
    const title = document.getElementById('doc-title').value;
    const content = document.getElementById('doc-content').value;
    await fetch(`${API}/documents`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ title, content, createdBy: currentUser.username }) });
    loadDocs();
}
async function loadRanks() {
    const res = await fetch(`${API}/ranks`);
    const ranks = await res.json();
    document.getElementById('ranks-list-container').innerHTML = ranks.map(r => `
        <div class="card" style="border-left: 5px solid ${r.color}">
             <strong>${r.name}</strong><br><small>${r.permissions.join(', ')}</small>
             ${r.name !== 'admin' ? `<button onclick="deleteRank('${r.name}')" style="background:#c0392b; float:right; padding:5px;">Löschen</button>` : ''}
        </div>
    `).join('');
}
async function saveRank() {
    const name = document.getElementById('new-rank-name').value;
    const color = document.getElementById('new-rank-color').value;
    const perms = [];
    if(document.getElementById('perm-docs').checked) perms.push('access_docs');
    if(document.getElementById('perm-users').checked) perms.push('manage_users');
    if(document.getElementById('perm-kick').checked) perms.push('kick_users');
    if(document.getElementById('perm-ranks').checked) perms.push('manage_ranks');
    if(!name) return alert('Name fehlt!');
    await fetch(`${API}/ranks`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name, color, permissions: perms }) });
    loadRanks();
}
async function deleteRank(name) {
    if(confirm('Löschen?')) { await fetch(`${API}/ranks/${name}`, { method: 'DELETE' }); loadRanks(); }
}

function showRegister() { document.getElementById('login-screen').style.display = 'none'; document.getElementById('register-screen').style.display = 'flex'; }
function showLogin() { document.getElementById('register-screen').style.display = 'none'; document.getElementById('login-screen').style.display = 'flex'; }
async function register() {
    const data = { username: document.getElementById('reg-user').value, fullName: document.getElementById('reg-name').value, password: document.getElementById('reg-pass').value };
    const res = await fetch(`${API}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) { alert('Registriert!'); showLogin(); }
}
function logout() { location.reload(); }