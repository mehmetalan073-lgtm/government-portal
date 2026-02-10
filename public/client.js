const API = '/api';
let currentUser = null;
let allUsers = [];
let allRanks = [];
let selectedUser = null;
let heartbeatInterval = null;

async function login() {
    const u = document.getElementById('login-user').value;
    const p = document.getElementById('login-pass').value;
    if(document.getElementById('login-error')) document.getElementById('login-error').style.display = 'none';
    try {
        const res = await fetch(`${API}/login`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username:u, password:p}) });
        const data = await res.json();
        if(data.success) {
            currentUser = data.user;
            setupDashboard();
            startHeartbeat(); 
        } else if(data.error === 'banned') { startBanTimer(data.remainingSeconds); } 
        else { alert(data.error); }
    } catch(e) { alert('Verbindungsfehler'); }
}

function startBanTimer(sec) {
    const timer = document.getElementById('ban-timer');
    let t = sec;
    const i = setInterval(() => {
        t--;
        if(t<=0) { clearInterval(i); timer.innerText="Frei."; timer.style.color="green"; }
        else { timer.innerText=`Sperre: ${Math.floor(t/60)}m ${t%60}s`; }
    }, 1000);
}

function setupDashboard() {
    document.getElementById('login-screen').style.display='none';
    document.getElementById('dashboard').style.display='flex';
    document.getElementById('profile-name').innerText = currentUser.fullName;
    document.getElementById('profile-rank').innerText = `${currentUser.rank} (Lvl ${currentUser.level})`;
    document.getElementById('profile-rank').style.backgroundColor = currentUser.color || '#999';
    const p = currentUser.permissions || [];
    if(p.includes('manage_users')) document.getElementById('nav-users').querySelector('.lock').style.display='none';
    if(p.includes('manage_ranks')) document.getElementById('nav-ranks').querySelector('.lock').style.display='none';
    switchTab('docs');
}

function startHeartbeat() {
    if(heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(async ()=>{
        if(!currentUser) return;
        const res = await fetch(`${API}/heartbeat`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser.username})});
        const d = await res.json();
        if(d.kicked) { alert(`GEKICKT!\nGrund: ${d.reason}`); location.reload(); }
    }, 2000);
}

function switchTab(t) {
    const p = currentUser.permissions||[];
    if(t==='users' && !p.includes('manage_users')) return;
    if(t==='ranks' && !p.includes('manage_ranks')) return;
    document.querySelectorAll('.tab').forEach(e=>e.style.display='none');
    document.getElementById(`tab-${t}`).style.display='block';
    if(t==='users') loadUsers();
    if(t==='ranks') { loadRanks(); cancelRankEdit(); }
    if(t==='docs') loadDocs();
}

// --- RÄNGE (LOGIK UPDATE) ---
async function loadRanks() {
    const res = await fetch(`${API}/ranks`);
    allRanks = await res.json();
    const container = document.getElementById('ranks-list-container');
    
    container.innerHTML = allRanks.map(r => {
        // REGEL: Ich darf nur Ränge bewegen, die unter mir sind (Level > Mein Level)
        const canManage = r.level > currentUser.level || currentUser.rank === 'admin';
        // Visuelles Feedback
        const opacity = canManage ? 1 : 0.5;
        const cursor = canManage ? 'grab' : 'not-allowed';
        const icon = canManage ? '≡' : '🔒';

        // draggable attribut nur setzen wenn erlaubt
        return `
        <div class="card rank-card" 
             draggable="${canManage}" 
             data-name="${r.name}" 
             onclick="${canManage ? `editRank('${r.name}')` : ''}" 
             style="border-left:5px solid ${r.color}; cursor:${cursor}; opacity:${opacity};">
             <div style="display:flex; justify-content:space-between;">
                 <strong>${r.name}</strong>
                 <span style="font-weight:bold; color:#7f8c8d;">${icon}</span>
             </div>
             <small>Lvl ${r.level}</small>
        </div>
    `}).join('');

    initDragAndDrop(); 
}

function initDragAndDrop() {
    // Wähle nur Karten aus, die draggable="true" sind
    const draggables = document.querySelectorAll('.rank-card[draggable="true"]');
    const container = document.getElementById('ranks-list-container');

    draggables.forEach(draggable => {
        draggable.addEventListener('dragstart', () => { draggable.classList.add('dragging'); });
        draggable.addEventListener('dragend', () => { draggable.classList.remove('dragging'); });
    });

    container.addEventListener('dragover', e => {
        e.preventDefault();
        const afterElement = getDragAfterElement(container, e.clientY, e.clientX);
        const draggable = document.querySelector('.dragging');
        if(!draggable) return; // Sicherheitscheck
        if (afterElement == null) { container.appendChild(draggable); } 
        else { container.insertBefore(draggable, afterElement); }
    });
}

function getDragAfterElement(container, y, x) {
    // WICHTIG: Man darf auch nicht VOR eine Karte droppen, die gesperrt ist (höheres Level)
    // Aber das regelt das Backend zusätzlich. Hier UI Logik:
    const draggableElements = [...container.querySelectorAll('.rank-card:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) { return { offset: offset, element: child }; } 
        else { return closest; }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

async function saveRankOrder() {
    const cards = document.querySelectorAll('.rank-card');
    const rankNames = Array.from(cards).map(card => card.getAttribute('data-name'));
    
    // Wir senden wer es ausführt
    const res = await fetch(`${API}/ranks/reorder`, {
        method: 'POST', 
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ rankNames, executedBy: currentUser.username })
    });
    const d = await res.json();
    if(d.error) alert('Fehler: ' + d.error);
    else { alert('Gespeichert!'); loadRanks(); }
}

function editRank(name) {
    const r = allRanks.find(x => x.name === name);
    if(!r) return;
    document.getElementById('new-rank-name').value = r.name;
    document.getElementById('new-rank-name').disabled = true;
    document.getElementById('new-rank-color').value = r.color;
    
    // Checkboxen: Nur aktivieren wenn USER das Recht selbst hat (oder Admin ist)
    const myPerms = currentUser.permissions;
    const isAdmin = currentUser.username === 'admin';

    setupCheckbox('perm-docs', 'access_docs', r.permissions, myPerms, isAdmin);
    setupCheckbox('perm-users', 'manage_users', r.permissions, myPerms, isAdmin);
    setupCheckbox('perm-kick', 'kick_users', r.permissions, myPerms, isAdmin);
    setupCheckbox('perm-ranks', 'manage_ranks', r.permissions, myPerms, isAdmin);

    document.getElementById('btn-save-rank').innerText = "Speichern";
    document.getElementById('btn-delete-rank').style.display = "block";
    document.getElementById('btn-cancel-rank').style.display = "block";
}

// Hilfsfunktion für Checkboxen
function setupCheckbox(elmId, permName, rankPerms, myPerms, isAdmin) {
    const cb = document.getElementById(elmId);
    cb.checked = rankPerms.includes(permName);
    
    // Wenn ich das Recht selbst NICHT habe, darf ich es auch nicht ändern/vergeben
    if (!myPerms.includes(permName) && !isAdmin) {
        cb.disabled = true;
        // Optisch kennzeichnen (z.B. Eltern-Label grau machen)
        cb.parentElement.style.color = '#ccc';
        cb.parentElement.title = "Du besitzt dieses Recht nicht.";
    } else {
        cb.disabled = false;
        cb.parentElement.style.color = '';
        cb.parentElement.title = "";
    }
}

function cancelRankEdit() {
    document.getElementById('new-rank-name').value = '';
    document.getElementById('new-rank-name').disabled = false;
    document.getElementById('new-rank-color').value = '#3498db';
    
    // Checkboxen reset
    document.querySelectorAll('input[type=checkbox]').forEach(c=> {
        c.checked=false; 
        c.disabled=false;
        c.parentElement.style.color='';
    });
    
    document.getElementById('btn-save-rank').innerText = "Erstellen";
    document.getElementById('btn-delete-rank').style.display = "none";
    document.getElementById('btn-cancel-rank').style.display = "none";
}

async function saveRank() {
    const name = document.getElementById('new-rank-name').value;
    const color = document.getElementById('new-rank-color').value;
    const p = [];
    if(document.getElementById('perm-docs').checked) p.push('access_docs');
    if(document.getElementById('perm-users').checked) p.push('manage_users');
    if(document.getElementById('perm-kick').checked) p.push('kick_users');
    if(document.getElementById('perm-ranks').checked) p.push('manage_ranks');

    if(!name) return alert('Name fehlt');
    
    const res = await fetch(`${API}/ranks`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, color, permissions: p, executedBy: currentUser.username })
    });
    const d = await res.json();
    if(d.error) alert(d.error); else { alert('Gespeichert!'); cancelRankEdit(); loadRanks(); }
}

async function deleteRankTrigger() {
    const name = document.getElementById('new-rank-name').value;
    if(confirm(`Rang "${name}" löschen?`)) {
        const res = await fetch(`${API}/ranks/${name}`, { 
            method: 'DELETE',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ executedBy: currentUser.username })
        });
        const d = await res.json();
        if(d.error) alert(d.error); else { alert('Gelöscht'); cancelRankEdit(); loadRanks(); }
    }
}

// REST (Standard Funktionen)
async function loadUsers() { const res = await fetch(`${API}/users`); allUsers = await res.json(); filterUsers(); }
function filterUsers() {
    const t = document.getElementById('user-search').value.toLowerCase();
    document.getElementById('users-list').innerHTML = allUsers.filter(u=>u.username.includes(t)||u.full_name.toLowerCase().includes(t)).map(u => {
        const o = (new Date()-new Date(u.last_seen))<60000;
        return `<div class="card" onclick="openModal('${u.username}')" style="display:flex; justify-content:space-between;">
            <div><strong>${u.full_name}</strong> <div>${o?'🟢':'⚫'}</div></div> <span class="badge" style="background:${u.color}">${u.rank}</span></div>`;
    }).join('');
}
async function openModal(un) {
    selectedUser = allUsers.find(u=>u.username===un);
    document.getElementById('user-modal').style.display='flex';
    document.getElementById('modal-username').innerText=un;
    const rk = await (await fetch(`${API}/ranks`)).json();
    document.getElementById('modal-rank-select').innerHTML=rk.map(r=>`<option value="${r.name}" ${r.name===selectedUser.rank?'selected':''}>${r.name}</option>`).join('');
    document.getElementById('kick-section').style.display = currentUser.permissions.includes('kick_users') ? 'block' : 'none';
}
function toggleBanInput() { document.getElementById('ban-duration-box').style.display = document.getElementById('kick-ban-check').checked ? 'block' : 'none'; }
async function kickUser() {
    const r = document.getElementById('kick-reason').value; const ban = document.getElementById('kick-ban-check').checked; const min = document.getElementById('kick-minutes').value;
    await fetch(`${API}/users/kick`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:selectedUser.username,reason:r,adminName:currentUser.username,isBan:ban,minutes:min})});
    alert('Ausgeführt'); closeModal(); loadUsers();
}
async function saveUserRank() { await fetch(`${API}/users/rank`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:selectedUser.username,newRank:document.getElementById('modal-rank-select').value})}); alert('Gespeichert'); closeModal(); loadUsers(); }
async function loadDocs() { const d = await (await fetch(`${API}/documents`)).json(); document.getElementById('docs-list').innerHTML=d.map(x=>`<div class="card"><h3>${x.title}</h3><p>${x.content}</p><small>${x.created_by}</small></div>`).join(''); }
async function createDoc() { await fetch(`${API}/documents`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:document.getElementById('doc-title').value,content:document.getElementById('doc-content').value,createdBy:currentUser.username})}); loadDocs(); }
function closeModal(){document.getElementById('user-modal').style.display='none'}
function showRegister(){document.getElementById('login-screen').style.display='none';document.getElementById('register-screen').style.display='flex'}
function showLogin(){document.getElementById('register-screen').style.display='none';document.getElementById('login-screen').style.display='flex'}
async function register(){ const res = await fetch(`${API}/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.getElementById('reg-user').value,fullName:document.getElementById('reg-name').value,password:document.getElementById('reg-pass').value})}); if(res.ok){alert('Registriert');showLogin()} }
function logout(){location.reload()}