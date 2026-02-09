const API = '/api'; // Automatisch relativ zum Server
let currentUser = null;

// Screens wechseln
function show(id) {
    document.querySelectorAll('.screen').forEach(el => el.style.display = 'none');
    document.getElementById(id).style.display = 'flex';
}

function showLogin() { show('login-screen'); }
function showRegister() { show('register-screen'); }

// Login Funktion
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
        document.getElementById('user-display').innerText = `👤 ${currentUser.fullName} (${currentUser.rank})`;
        
        // Admin Button zeigen?
        if (currentUser.rank === 'admin') document.getElementById('admin-btn').style.display = 'block';
        
        show('dashboard');
        loadDocs();
    } else {
        alert('Fehler: ' + data.error);
    }
}

// Registrieren
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
    
    if (res.ok) {
        alert('Erfolg! Bitte einloggen.');
        showLogin();
    } else {
        alert('Fehler bei der Registrierung.');
    }
}

// Tabs wechseln
function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(el => el.style.display = 'none');
    document.getElementById(`tab-${tabName}`).style.display = 'block';
    
    if(tabName === 'docs') loadDocs();
    if(tabName === 'users') loadUsers();
}

// Akten laden
async function loadDocs() {
    const res = await fetch(`${API}/documents`);
    const docs = await res.json();
    const container = document.getElementById('docs-list');
    
    container.innerHTML = docs.map(d => `
        <div class="list-item">
            <div>
                <strong>${d.title}</strong><br>
                <small>${d.content}</small>
            </div>
            <small>Von: ${d.created_by}</small>
        </div>
    `).join('');
}

// Akte erstellen
async function createDoc() {
    const title = document.getElementById('doc-title').value;
    const content = document.getElementById('doc-content').value;
    
    await fetch(`${API}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, createdBy: currentUser.username })
    });
    
    document.getElementById('doc-title').value = '';
    document.getElementById('doc-content').value = '';
    loadDocs();
}

// User laden (Admin)
async function loadUsers() {
    const res = await fetch(`${API}/users`);
    const users = await res.json();
    document.getElementById('users-list').innerHTML = users.map(u => `
        <div class="list-item">
            <strong>${u.full_name} (${u.username})</strong>
            <span>Rang: ${u.rank}</span>
        </div>
    `).join('');
}

function logout() { location.reload(); }