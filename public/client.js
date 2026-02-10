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
    document.getElementById('profile-rank').innerText = `${currentUser.rank}`;
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

// --- RÄNGE (DRAG & DROP) ---
async function loadRanks() {
    const res = await fetch(`${API}/ranks`);
    allRanks = await res.json();
    const container = document.getElementById('ranks-list-container');
    
    container.innerHTML = allRanks.map(r => `
        <div class="card rank-card" draggable="true" data-name="${r.name}" onclick="editRank('${r.name}')" 
             style="border-left:5px solid ${r.color}; cursor:grab;">
             <div style="display:flex; justify-content:space-between;">
                 <strong>${r.name}</strong>
                 <span style="font-weight:bold; color:#7f8c8d;">≡</span>
             </div>
             <small>Lvl ${r.level}</small>
        </div>
    `).join('');

    initDragAndDrop(); // Drag Funktion aktivieren
}

function initDragAndDrop() {
    const draggables = document.querySelectorAll('.rank-card');
    const container = document.getElementById('ranks-list-container');

    draggables.forEach(draggable => {
        draggable.addEventListener('dragstart', () => {
            draggable.classList.add('dragging');
        });
        draggable.addEventListener('dragend', () => {
            draggable.classList.remove('dragging');
        });
    });

    container.addEventListener('dragover', e => {
        e.preventDefault(); // Erlaubt das Droppen
        const afterElement = getDragAfterElement(container, e.clientY, e.clientX);
        const draggable = document.querySelector('.dragging');
        if (afterElement == null) {
            container.appendChild(draggable);
        } else {
            container.insertBefore(draggable, afterElement);
        }
    });
}

// Hilfsfunktion: Wo wird das Element hingeschoben?
function getDragAfterElement(container, y, x) {
    const draggableElements = [...container.querySelectorAll('.rank-card:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        // Einfache Distanzberechnung für Grid
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

async function saveRankOrder() {
    // Sammle alle Namen in der neuen Reihenfolge
    const cards = document.querySelectorAll('.rank-card');
    const rankNames = Array.from(cards).map(card => card.getAttribute('data-name'));
    
    await fetch(`${API}/ranks/reorder`, {
        method: 'POST', 
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ rankNames })
    });
    alert('Neue Hierarchie gespeichert!');
    loadRanks(); // Neu laden um Level Zahlen zu aktualisieren
}

function editRank(name) {
    const r = allRanks.find(x => x.name === name);
    if(!r) return;
    document.getElementById('new-rank-name').value = r.name;
    document.getElementById('new-rank-name').disabled = true;
    document.getElementById('new-rank-color').value = r.color;
    // Checkboxen
    document.getElementById('perm-docs').checked = r.permissions.includes('access_docs');
    document.getElementById('perm-users').checked = r.permissions.includes('manage_users');
    document.getElementById('perm-kick').checked = r.permissions.includes('kick_users');
    document.getElementById('perm-ranks').checked = r.permissions.includes('manage_ranks');

    document.getElementById('btn-save-rank').innerText = "Speichern";
    document.getElementById('btn-delete-rank').style.display = "block";
    document.getElementById('btn-cancel-rank').style.display = "block";
}

function cancelRankEdit() {
    document.getElementById('new-rank-name').value = '';
    document.getElementById('new-rank-name').disabled = false;
    document.getElementById('new-rank-color').value = '#3498db';
    document.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=false);
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
    
    await fetch(`${API}/ranks`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, color, permissions: p })
    });
    alert('Gespeichert! Bitte Reihenfolge ggf. anpassen.');
    cancelRankEdit(); 
    loadRanks();
}

async function deleteRankTrigger() {
    const name = document.getElementById('new-rank-name').value;
    if(confirm(`Rang "${name}" löschen?`)) {
        await fetch(`${API}/ranks/${name}`, { method: 'DELETE' });
        alert('Gelöscht'); cancelRankEdit(); loadRanks(); 
    }
}

// REST
async function loadUsers() {
    const res = await fetch(`${API}/users`); allUsers = await res.json(); filterUsers();
}
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