const API = '/api';
let currentUser = null;
let rankColors = {}; // Speichert die geladenen Farben

// --- AUTH & NAVIGATION ---

async function login() {
    const u = document.getElementById('login-user').value;
    const p = document.getElementById('login-pass').value;

    const res = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p })
    });

    const data = await res.json();
    if (data.success) {
        currentUser = data.user;
        
        // Farben laden, BEVOR wir das Dashboard anzeigen
        await loadRankColors();

        // Profil unten links updaten
        document.getElementById('profile-name').innerText = currentUser.fullName;
        const rankBadge = document.getElementById('profile-rank');
        rankBadge.innerText = currentUser.rank;
        rankBadge.style.backgroundColor = getRankColor(currentUser.rank);

        // Admin Buttons
        if (currentUser.rank === 'admin') {
            document.getElementById('admin-btn').style.display = 'block';
            document.getElementById('colors-btn').style.display = 'block';
        }
        
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'flex';
        loadDocs();
    } else {
        alert('Fehler: ' + data.error);
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(el => el.style.display = 'none');
    document.getElementById(`tab-${tabName}`).style.display = 'block';
    
    // Aktiven Button markieren
    document.querySelectorAll('.nav-links button').forEach(btn => btn.classList.remove('active'));
    // (Einfacher Hack: Wir gehen davon aus, dass onclick Button passt)
    
    if(tabName === 'docs') loadDocs();
    if(tabName === 'users') loadUsers();
    if(tabName === 'colors') renderColorSettings();
}

// --- FARBEN LOGIK ---

async function loadRankColors() {
    try {
        const res = await fetch(`${API}/rank-colors`);
        const colors = await res.json();
        // Umwandeln in einfaches Objekt: { 'admin': '#ff0000', ... }
        rankColors = {};
        colors.forEach(c => rankColors[c.rank_name] = c.color_hex);
    } catch (e) { console.error(e); }
}

function getRankColor(rank) {
    return rankColors[rank] || '#95a5a6'; // Standard Grau
}

// Admin: Einstellungen rendern
function renderColorSettings() {
    const ranks = ['admin', 'nc-team', 'user', 'besucher']; // Liste aller Ränge
    const container = document.getElementById('color-settings-list');
    
    container.innerHTML = ranks.map(rank => `
        <div class="color-setting-item">
            <strong>${rank.toUpperCase()}</strong>
            <input type="color" class="color-input" 
                   value="${getRankColor(rank)}" 
                   onchange="saveColor('${rank}', this.value)">
        </div>
    `).join('');
}

async function saveColor(rank, color) {
    await fetch(`${API}/rank-colors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rank, color })
    });
    
    // Lokal updaten
    rankColors[rank] = color;
    
    // Eigene Badge sofort aktualisieren, falls betroffen
    if(currentUser.rank === rank) {
        document.getElementById('profile-rank').style.backgroundColor = color;
    }
    
    // Falls wir gerade Listen anzeigen, diese auch refreshen
    // (Optional, hier nicht zwingend nötig)
}

// --- STANDARD FUNKTIONEN (Login, Docs, Users) ---

function showRegister() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('register-screen').style.display = 'flex';
}

function showLogin() {
    document.getElementById('register-screen').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
}

async function register() {
    const data = {
        username: document.getElementById('reg-user').value,
        fullName: document.getElementById('reg-name').value,
        password: document.getElementById('reg-pass').value
    };
    const res = await fetch(`${API}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (res.ok) { alert('Registriert!'); showLogin(); }
}

async function loadDocs() {
    const res = await fetch(`${API}/documents`);
    const docs = await res.json();
    document.getElementById('docs-list').innerHTML = docs.map(d => `
        <div class="card">
            <h3>${d.title}</h3>
            <p>${d.content}</p>
            <small style="color: ${getRankColor('user')}">Erstellt von: ${d.created_by}</small>
        </div>
    `).join('');
}

async function createDoc() {
    const title = document.getElementById('doc-title').value;
    const content = document.getElementById('doc-content').value;
    await fetch(`${API}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, createdBy: currentUser.username })
    });
    loadDocs();
}

async function loadUsers() {
    const res = await fetch(`${API}/users`);
    const users = await res.json();
    document.getElementById('users-list').innerHTML = users.map(u => `
        <div class="card" style="display:flex; justify-content:space-between;">
            <strong>${u.full_name}</strong>
            <span style="background:${getRankColor(u.rank)}; color:white; padding:2px 8px; border-radius:4px;">
                ${u.rank}
            </span>
        </div>
    `).join('');
}

function logout() { location.reload(); }