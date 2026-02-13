const API = '/api';
let currentUser = null;
let allUsers = [];
let allRanks = [];
let selectedUser = null;
let heartbeatInterval = null;

// --- LOGIN ---
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
        if(t<=0) { clearInterval(i); timer.innerText="Sperre vorbei."; timer.style.color="green"; }
        else { timer.innerText=`Sperre noch: ${Math.floor(t/60)}m ${t%60}s`; }
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
        if(d.kicked) { alert(`⚠️ DU WURDEST GEKICKT!\n\nGrund: ${d.reason}`); location.reload(); }
    }, 2000);
}

function toggleAdminMenu() {
    const m = document.getElementById('admin-submenu');
    const a = document.getElementById('admin-arrow');
    if(m.style.display==='none'){ m.style.display='block'; a.classList.add('rotate-down'); }
    else{ m.style.display='none'; a.classList.remove('rotate-down'); }
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

// --- RÄNGE MIT PFEILEN ---
async function loadRanks() {
    const res = await fetch(`${API}/ranks`);
    allRanks = await res.json();
    const container = document.getElementById('ranks-list-container');
    
    container.innerHTML = allRanks.map((r, index) => {
        // Logik: Darf ich diesen Rang bewegen? (Nur wenn Level > Mein Level)
        const canManage = r.level > currentUser.level || currentUser.rank === 'admin';
        
        let arrows = '';
        if (canManage) {
            // Pfeil Hoch (nur wenn nicht erster in der Liste)
            const upBtn = index > 0 ? `<button class="rank-btn" onclick="event.stopPropagation(); moveRank(${index}, -1)">▲</button>` : `<div class="rank-btn" style="opacity:0"></div>`;
            // Pfeil Runter (nur wenn nicht letzter)
            const downBtn = index < allRanks.length - 1 ? `<button class="rank-btn" onclick="event.stopPropagation(); moveRank(${index}, 1)">▼</button>` : `<div class="rank-btn" style="opacity:0"></div>`;
            
            arrows = `<div class="rank-actions">${upBtn}${downBtn}</div>`;
        }

        const icon = canManage ? '✏️' : '🔒';
        const opacity = canManage ? 1 : 0.6;
        const cursor = canManage ? 'pointer' : 'not-allowed';

        return `
        <div class="card rank-card" onclick="${canManage ? `editRank('${r.name}')` : ''}" 
             style="border-left:6px solid ${r.color}; cursor:${cursor}; opacity:${opacity}">
             <div style="display:flex; justify-content:space-between; align-items:center;">
                 <div>
                    <strong style="font-size:1.1em">${r.name}</strong><br>
                    <small style="color:#7f8c8d">Level ${r.level}</small>
                 </div>
                 <span style="font-size:1.2em;">${icon}</span>
             </div>
             ${arrows}
        </div>`;
    }).join('');
}

// Neue Funktion: Rang verschieben
async function moveRank(index, direction) {
    // direction: -1 = hoch, 1 = runter
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= allRanks.length) return;

    // Wir tauschen die Positionen im Array visuell
    const temp = allRanks[index];
    allRanks[index] = allRanks[newIndex];
    allRanks[newIndex] = temp;

    // Wir erstellen die neue Namensliste
    const rankNames = allRanks.map(r => r.name);

    // An Server senden
    const res = await fetch(`${API}/ranks/reorder`, {
        method: 'POST', 
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ rankNames, executedBy: currentUser.username })
    });
    
    const d = await res.json();
    if(d.error) {
        alert("Fehler: " + d.error);
        loadRanks(); // Zurücksetzen bei Fehler
    } else {
        loadRanks(); // Neu laden (Level Zahlen updaten sich)
    }
}

function editRank(name) {
    const r = allRanks.find(x => x.name === name);
    if(!r) return;
    document.getElementById('new-rank-name').value = r.name;
    document.getElementById('new-rank-name').disabled = true;
    document.getElementById('new-rank-color').value = r.color;

    const myPerms = currentUser.permissions;
    const isAdmin = currentUser.username === 'admin';
    setupCheckbox('perm-docs', 'access_docs', r.permissions, myPerms, isAdmin);
    setupCheckbox('perm-users', 'manage_users', r.permissions, myPerms, isAdmin);
    setupCheckbox('perm-kick', 'kick_users', r.permissions, myPerms, isAdmin);
    setupCheckbox('perm-ranks', 'manage_ranks', r.permissions, myPerms, isAdmin);

    document.getElementById('btn-save-rank').innerText = "Änderungen speichern";
    document.getElementById('btn-delete-rank').style.display = "block";
    document.getElementById('btn-cancel-rank').style.display = "block";
    // Scrollen
    document.getElementById('rank-form-container').scrollIntoView({behavior: 'smooth'});
}

function setupCheckbox(elmId, permName, rankPerms, myPerms, isAdmin) {
    const cb = document.getElementById(elmId);
    cb.checked = rankPerms.includes(permName);
    if (!myPerms.includes(permName) && !isAdmin) {
        cb.disabled = true;
        cb.parentElement.style.opacity = "0.5";
    } else {
        cb.disabled = false;
        cb.parentElement.style.opacity = "1";
    }
}

function cancelRankEdit() {
    document.getElementById('new-rank-name').value = '';
    document.getElementById('new-rank-name').disabled = false;
    document.getElementById('new-rank-color').value = '#3498db';
    document.querySelectorAll('input[type=checkbox]').forEach(c=>{c.checked=false; c.disabled=false; c.parentElement.style.opacity="1";});
    document.getElementById('btn-save-rank').innerText = "Neuen Rang erstellen";
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
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, color, permissions: p, executedBy: currentUser.username })
    });
    const d = await res.json();
    if(d.error) alert(d.error); else { alert('Gespeichert!'); cancelRankEdit(); loadRanks(); }
}

async function deleteRankTrigger() {
    const name = document.getElementById('new-rank-name').value;
    if(confirm(`Rang "${name}" löschen?`)) {
        const res = await fetch(`${API}/ranks/${name}`, { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ executedBy: currentUser.username }) });
        const d = await res.json();
        if(d.error) alert(d.error); else { alert('Gelöscht'); cancelRankEdit(); loadRanks(); }
    }
}

// REST
async function loadUsers() { const res = await fetch(`${API}/users`); allUsers = await res.json(); filterUsers(); }
function filterUsers() {
    const t = document.getElementById('user-search').value.toLowerCase();
    document.getElementById('users-list').innerHTML = allUsers.filter(u=>u.username.includes(t)||u.full_name.toLowerCase().includes(t)).map(u => {
        const o = (new Date()-new Date(u.last_seen))<60000;
        return `<div class="card user-card" onclick="openModal('${u.username}')" style="display:flex; justify-content:space-between; align-items:center;">
            <div><strong>${u.full_name}</strong> <small>(${u.username})</small> <div>${o?'🟢 Online':'⚫ Offline'}</div></div> <span class="badge" style="background:${u.color}">${u.rank}</span></div>`;
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