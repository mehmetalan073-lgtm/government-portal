const API = '/api';
let currentUser = null;
let allRanks = [];

async function login() {
    const u = document.getElementById('login-user').value;
    const p = document.getElementById('login-pass').value;

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
        } else {
            alert('Fehler: ' + data.error);
        }
    } catch (e) { alert('Verbindungsfehler'); console.error(e); }
}

function setupDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';

    document.getElementById('profile-name').innerText = currentUser.fullName;
    const badge = document.getElementById('profile-rank');
    badge.innerText = currentUser.rank;
    badge.style.backgroundColor = currentUser.color || '#95a5a6';

    const perms = currentUser.permissions || [];
    console.log("Deine Rechte:", perms); 

    // TAB SICHTBARKEIT STEUERN
    if (perms.includes('access_docs')) {
        document.getElementById('nav-docs').style.display = 'block';
        loadDocs();
    } else { 
        document.getElementById('nav-docs').style.display = 'none'; 
    }

    if (perms.includes('manage_users')) {
        document.getElementById('nav-users').style.display = 'block';
    }

    if (perms.includes('manage_ranks')) {
        document.getElementById('nav-ranks').style.display = 'block';
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(el => el.style.display = 'none');
    document.getElementById(`tab-${tabName}`).style.display = 'block';
    
    if(tabName === 'users') loadUsersAndRanks();
    if(tabName === 'ranks') loadRanksManagement();
    if(tabName === 'docs') loadDocs();
}

// --- RANG MANAGEMENT ---

async function loadRanksManagement() {
    const res = await fetch(`${API}/ranks`);
    allRanks = await res.json();
    
    document.getElementById('ranks-list-container').innerHTML = allRanks.map(r => `
        <div class="card" style="border-left: 5px solid ${r.color}; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <strong>${r.name}</strong><br>
                <small>Rechte: ${r.permissions.join(', ') || 'Keine'}</small>
            </div>
            <div>
                <button onclick="editRank('${r.name}')" style="background:#f39c12; padding:5px 10px;">Edit</button>
                ${r.name !== 'admin' ? `<button onclick="deleteRank('${r.name}')" style="background:#c0392b; padding:5px 10px;">Löschen</button>` : ''}
            </div>
        </div>
    `).join('');
}

async function saveRank() {
    const name = document.getElementById('new-rank-name').value;
    const color = document.getElementById('new-rank-color').value;
    
    const permissions = [];
    if(document.getElementById('perm-docs').checked) permissions.push('access_docs');
    if(document.getElementById('perm-users').checked) permissions.push('manage_users');
    if(document.getElementById('perm-ranks').checked) permissions.push('manage_ranks');

    if(!name) return alert('Name fehlt!');

    await fetch(`${API}/ranks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color, permissions })
    });
    
    alert('Gespeichert!');
    document.getElementById('new-rank-name').value = '';
    loadRanksManagement();
}

async function deleteRank(name) {
    if(!confirm(`Rang "${name}" löschen?`)) return;
    await fetch(`${API}/ranks/${name}`, { method: 'DELETE' });
    loadRanksManagement();
}

function editRank(name) {
    const rank = allRanks.find(r => r.name === name);
    if(!rank) return;
    document.getElementById('new-rank-name').value = rank.name;
    document.getElementById('new-rank-color').value = rank.color;
    document.getElementById('perm-docs').checked = rank.permissions.includes('access_docs');
    document.getElementById('perm-users').checked = rank.permissions.includes('manage_users');
    document.getElementById('perm-ranks').checked = rank.permissions.includes('manage_ranks');
}

// --- USER & DOCS ---

async function loadUsersAndRanks() {
    const resU = await fetch(`${API}/users`);
    const users = await resU.json();
    const resR = await fetch(`${API}/ranks`);
    const ranks = await resR.json();
    
    document.getElementById('assign-rank-select').innerHTML = ranks.map(r => `<option value="${r.name}">${r.name}</option>`).join('');
    document.getElementById('users-list').innerHTML = users.map(u => `
        <div class="card" style="display:flex; justify-content:space-between;">
            <strong>${u.full_name} (${u.username})</strong>
            <span style="background:${u.color || '#ddd'}; color:white; padding:2px 8px; border-radius:4px;">${u.rank}</span>
        </div>
    `).join('');
}

async function assignRank() {
    const username = document.getElementById('assign-user').value;
    const newRank = document.getElementById('assign-rank-select').value;
    await fetch(`${API}/users/rank`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, newRank }) });
    alert('Zugewiesen!');
    loadUsersAndRanks();
}

async function loadDocs() {
    const res = await fetch(`${API}/documents`);
    const docs = await res.json();
    document.getElementById('docs-list').innerHTML = docs.map(d => `
        <div class="card">
            <h3>${d.title}</h3>
            <p>${d.content}</p>
            <small>Von: ${d.created_by}</small>
        </div>
    `).join('');
}

async function createDoc() {
    const title = document.getElementById('doc-title').value;
    const content = document.getElementById('doc-content').value;
    await fetch(`${API}/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, content, createdBy: currentUser.username }) });
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