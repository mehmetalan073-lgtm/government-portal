const API = '/api';
let currentUser = null;
let allUsers = [];

// --- LOGIN & START ---
async function login() {
    const u = document.getElementById('login-user').value;
    const p = document.getElementById('login-pass').value;
    
    // Fehler zurücksetzen
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
            startHeartbeat(); // Startet den Online-Check
        } else if (data.error === 'banned') {
            startBanTimer(new Date(data.bannedUntil));
        } else {
            alert('Fehler: ' + data.error);
        }
    } catch (e) { 
        console.error(e);
        alert('Verbindungsfehler! Schau in die Konsole.'); 
    }
}

// --- DASHBOARD AUFBAU ---
function setupDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';

    document.getElementById('profile-name').innerText = currentUser.fullName;
    const badge = document.getElementById('profile-rank');
    badge.innerText = currentUser.rank;
    // Neue Logik: Farbe kommt direkt vom User, nicht mehr extra abrufen
    badge.style.backgroundColor = currentUser.color || '#95a5a6';

    const perms = currentUser.permissions || [];
    
    // SCHLÖSSER ENTFERNEN (wenn Recht vorhanden)
    if (perms.includes('manage_users')) {
        const btn = document.getElementById('nav-users');
        if(btn.querySelector('.lock')) btn.querySelector('.lock').style.display = 'none';
    }
    if (perms.includes('manage_ranks')) {
        const btn = document.getElementById('nav-ranks');
        if(btn.querySelector('.lock')) btn.querySelector('.lock').style.display = 'none';
    }

    // Standard-Tab öffnen
    switchTab('docs');
}

// --- ONLINE STATUS & KICK CHECK ---
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
            alert('Du wurdest vom Admin gekickt!');
            location.reload(); 
        }
    }, 10000); // Alle 10 Sekunden prüfen
}

// --- BANN TIMER (wenn Login fehlschlägt) ---
function startBanTimer(endTime) {
    const timerBox = document.getElementById('ban-timer');
    if(!timerBox) return; // Falls Element fehlt
    
    const interval = setInterval(() => {
        const now = new Date();
        const diff = endTime - now;
        if (diff <= 0) {
            clearInterval(interval);
            timerBox.innerText = "Sperre vorbei. Bitte neu anmelden.";
            timerBox.style.color = "green";
        } else {
            const min = Math.floor((diff / 1000 / 60) % 60);
            const sec = Math.floor((diff / 1000) % 60);
            timerBox.innerText = `Gesperrt für: ${min}m ${sec}s`;
        }
    }, 1000);
}

// --- TAB NAVIGATION ---
function switchTab(tabName) {
    const perms = currentUser.permissions || [];
    
    // Schutz: Nicht öffnen, wenn keine Rechte
    if (tabName === 'users' && !perms.includes('manage_users')) return;
    if (tabName === 'ranks' && !perms.includes('manage_ranks')) return;

    document.querySelectorAll('.tab').forEach(el => el.style.display = 'none');
    document.getElementById(`tab-${tabName}`).style.display = 'block';
    
    if(tabName === 'users') loadUsers();
    if(tabName === 'ranks') loadRanks();
    if(tabName === 'docs') loadDocs();
}

// --- PERSONAL VERWALTUNG (Neu) ---
async function loadUsers() {
    const res = await fetch(`${API}/users`);
    allUsers = await res.json();
    filterUsers();
}

function filterUsers() {
    const term = document.getElementById('user-search') ? document.getElementById('user-search').value.toLowerCase() : '';
    const list = document.getElementById('users-list');
    
    const filtered = allUsers.filter(u => u.username.toLowerCase().includes(term) || u.full_name.toLowerCase().includes(term));

    list.innerHTML = filtered.map(u => {
        // Online Check (war User in den letzten 60s aktiv?)
        const lastSeen = u.last_seen ? new Date(u.last_seen) : new Date(0);
        const isOnline = (new Date() - lastSeen) < 60000; 
        
        return `
        <div class="card" onclick="openModal('${u.username}')" style="display:flex; justify-content:space-between;">
            <div>
                <strong>${u.full_name}</strong> <small>(${u.username})</small>
                <div>${isOnline ? '🟢 Online' : '⚫ Offline'}</div>
            </div>
            <span style="background:${u.color || '#ddd'}; padding:2px 8px; border-radius:4px; color:white; height:fit-content;">${u.rank}</span>
        </div>`;
    }).join('');
}

function openModal(username) {
    document.getElementById('user-modal').style.display = 'flex';
    document.getElementById('modal-username').innerText = username;
}

function closeModal() { document.getElementById('user-modal').style.display = 'none'; }

async function kickUser() {
    const username = document.getElementById('modal-username').innerText;
    const minutes = document.getElementById('kick-minutes').value;
    
    await fetch(`${API}/users/kick`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username, minutes })
    });
    alert('User gekickt!');
    closeModal();
    loadUsers();
}

// --- RÄNGE (Neu: /api/ranks statt rank-colors) ---
async function loadRanks() {
    const res = await fetch(`${API}/ranks`);
    const ranks = await res.json();
    document.getElementById('ranks-list-container').innerHTML = ranks.map(r => `
        <div class="card" style="border-left: 5px solid ${r.color}">
             <strong>${r.name}</strong><br><small>${r.permissions.join(', ')}</small>
             ${r.name !== 'admin' ? `<button onclick="deleteRank('${r.name}')" style="float:right; background:#c0392b; color:white; border:none; padding:5px;">Löschen</button>` : ''}
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
    await fetch(`${API}/ranks`, { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({ name, color, permissions: perms }) 
    });
    alert('Gespeichert!');
    loadRanks();
}

async function deleteRank(name) {
    if(confirm('Wirklich löschen?')) { 
        await fetch(`${API}/ranks/${name}`, { method: 'DELETE' }); 
        loadRanks(); 
    }
}

// --- STANDARDS (Akten, Register) ---
async function loadDocs() {
    const res = await fetch(`${API}/documents`);
    const docs = await res.json();
    const list = document.getElementById('docs-list');
    if(list) list.innerHTML = docs.map(d => `<div class="card"><h3>${d.title}</h3><p>${d.content}</p><small>Von: ${d.created_by}</small></div>`).join('');
}

async function createDoc() {
    const title = document.getElementById('doc-title').value;
    const content = document.getElementById('doc-content').value;
    await fetch(`${API}/documents`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ title, content, createdBy: currentUser.username }) });
    loadDocs();
}

function showRegister() { document.getElementById('login-screen').style.display = 'none'; document.getElementById('register-screen').style.display = 'flex'; }
function showLogin() { document.getElementById('register-screen').style.display = 'none'; document.getElementById('login-screen').style.display = 'flex'; }
async function register() {
    const data = { username: document.getElementById('reg-user').value, fullName: document.getElementById('reg-name').value, password: document.getElementById('reg-pass').value };
    const res = await fetch(`${API}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) { alert('Registriert!'); showLogin(); }
}
function logout() { location.reload(); }