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
    
    // TAB SICHTBARKEIT
    if(p.includes('access_meeting')) document.getElementById('nav-meeting').style.display='block';
    
    // Erstellen-Button nur für Leute mit Akten-Recht
    if(p.includes('access_docs') || currentUser.username === 'admin') {
        document.getElementById('btn-create-form').style.display = 'block';
    }

    // Ordner Inhalt
    if(p.includes('manage_users')) document.getElementById('nav-users').querySelector('.lock').style.display='none';
    if(p.includes('manage_ranks')) document.getElementById('nav-ranks').querySelector('.lock').style.display='none';
    
    // Standard Tab: Meeting wenn erlaubt, sonst Docs
    if(p.includes('access_meeting')) switchTab('meeting'); else switchTab('docs');
}

function startHeartbeat() {
    if(heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(async ()=>{
        if(!currentUser) return;
        const res = await fetch(`${API}/heartbeat`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser.username})});
        const d = await res.json();
        if(d.kicked) { alert(`⚠️ DU WURDEST GEKICKT!\n\nGrund: ${d.reason}`); location.reload(); }
    }, 10000); // 10s Takt
}

function toggleAdminMenu() {
    const m = document.getElementById('admin-submenu');
    const a = document.getElementById('admin-arrow');
    if(m.style.display==='none'){ m.style.display='block'; a.classList.add('rotate-down'); }
    else{ m.style.display='none'; a.classList.remove('rotate-down'); }
}

function switchTab(t) {
    const p = currentUser.permissions||[];
    if(t==='meeting' && !p.includes('access_meeting')) return;
    if(t==='users' && !p.includes('manage_users')) return;
    if(t==='ranks' && !p.includes('manage_ranks')) return;

    document.querySelectorAll('.tab').forEach(e=>e.style.display='none');
    document.getElementById(`tab-${t}`).style.display='block';
    
    if(t==='users') loadUsers();
    if(t==='ranks') { loadRanks(); cancelRankEdit(); }
    if(t==='meeting') loadMeetingPoints();
    if(t==='docs') {
        // Beim Klick auf Akten immer standardmäßig im "Anfertigen"-Tab starten
        switchDocsSubTab('create'); 
    }
}

// NEU: Umschalten zwischen "Anfertigen" und "Ansehen" (inklusive Farbwechsel)
function switchDocsSubTab(t) {
    document.getElementById('sub-docs-create').style.display = t === 'create' ? 'block' : 'none';
    document.getElementById('sub-docs-view').style.display = t === 'view' ? 'block' : 'none';
    
    // Buttons abrufen
    const btnCreate = document.getElementById('btn-sub-create');
    const btnView = document.getElementById('btn-sub-view');

    if (t === 'create') {
        btnCreate.style.background = '#2c3e50'; // Dunkel (Aktiv)
        btnView.style.background = '#95a5a6';   // Hellgrau (Inaktiv)
        loadForms();
    } else if (t === 'view') {
        btnCreate.style.background = '#95a5a6';   // Hellgrau (Inaktiv)
        btnView.style.background = '#2c3e50'; // Dunkel (Aktiv)
        loadSubmittedDocs();
    }
}

// --- AKTEN ANSICHT & ARCHIV ---
let allSubmissions = [];

async function loadSubmittedDocs() {
    const res = await fetch(`${API}/forms/submissions`);
    allSubmissions = await res.json();
    renderSubmittedDocs(); 
}

function renderSubmittedDocs() {
    const filter = document.getElementById('docs-filter').value;
    const sort = document.getElementById('docs-sort').value;
    const search = document.getElementById('docs-search').value.toLowerCase();
    const list = document.getElementById('submitted-docs-list');
    
    // 1. Filtern (Meine, Alle, Markiert + Suche)
    let filtered = allSubmissions.filter(sub => {
        const isMarked = (sub.marked_by || []).includes(currentUser.username);
        const matchFilter = filter === 'all' || 
                            (filter === 'mine' && sub.username === currentUser.username) ||
                            (filter === 'marked' && isMarked);
        const matchSearch = sub.form_title.toLowerCase().includes(search) || sub.username.toLowerCase().includes(search) || String(sub.id).includes(search);
        return matchFilter && matchSearch;
    });

    // 2. Sortieren (Nach Datum)
    filtered.sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return sort === 'newest' ? dateB - dateA : dateA - dateB;
    });

    if (filtered.length === 0) {
        list.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:40px; color:#7f8c8d; background:white; border-radius:12px;">📭 Keine Akten gefunden.</div>';
        return;
    }

    // 3. Karten zeichnen
    list.innerHTML = filtered.map(sub => {
        const date = new Date(sub.created_at).toLocaleString('de-DE', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});
        const isMine = sub.username === currentUser.username;
        const color = isMine ? '#27ae60' : '#3498db';
        const badgeStr = isMine ? `<span class="badge" style="background:#27ae60;">👤 Meine Akte</span>` : `<span class="badge" style="background:#7f8c8d;">Von ${sub.username}</span>`;
        
        // Markierungs-Stern prüfen
        const isMarked = (sub.marked_by || []).includes(currentUser.username);
        const starColor = isMarked ? '#f1c40f' : '#bdc3c7'; // Gelb oder Grau

        return `
        <div class="card" style="border-left:5px solid ${color}; transition:transform 0.2s; position:relative;">
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <h3 style="margin:0 0 10px 0; color:#2c3e50; cursor:pointer;" onclick="openDocModal(${sub.id})">Akte #${String(sub.id).padStart(4, '0')}</h3>
                <div style="display:flex; gap:10px; align-items:center;">
                    ${badgeStr}
                    <span onclick="toggleMark(${sub.id})" style="font-size:1.5em; cursor:pointer; color:${starColor};" title="Akte markieren">★</span>
                </div>
            </div>
            <div onclick="openDocModal(${sub.id})" style="cursor:pointer;">
                <div style="font-weight:bold; font-size:1.1em; color:#34495e; margin-bottom:15px;">${sub.form_title}</div>
                <div style="color:#7f8c8d; font-size:0.85em; display:flex; gap:15px;">
                    <span>📅 ${date}</span>
                    <span>📋 ${sub.questions.length} Felder</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

// Akte als Favorit markieren / entmarkieren
async function toggleMark(id) {
    const res = await fetch(`${API}/forms/submissions/mark`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({submissionId: id, username: currentUser.username})
    });
    const data = await res.json();
    if(data.success) {
        const sub = allSubmissions.find(s => s.id === id);
        if(sub) sub.marked_by = data.markedBy;
        renderSubmittedDocs(); // Aktualisiert die Sterne sofort
    }
}

// Popup-Vorschau öffnen
let currentViewSub = null;
function openDocModal(id) {
    currentViewSub = allSubmissions.find(s => s.id === id);
    if(!currentViewSub) return;
    
    document.getElementById('doc-view-modal').style.display = 'flex';
    document.getElementById('view-doc-title').innerText = `${currentViewSub.form_title}`;
    document.getElementById('view-doc-badge').innerText = `Akte #${String(currentViewSub.id).padStart(4, '0')}`;
    
    const dateStr = new Date(currentViewSub.created_at).toLocaleString('de-DE', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});
    document.getElementById('view-doc-meta').innerHTML = `Eingereicht von <strong style="color:#2c3e50;">${currentViewSub.username}</strong> am ${dateStr}`;

    const answersArray = typeof currentViewSub.answers === 'string' ? JSON.parse(currentViewSub.answers) : currentViewSub.answers;

    let contentHTML = '';
    currentViewSub.questions.forEach((q, idx) => {
        contentHTML += `<div style="margin-bottom:20px;">
            <div style="font-size:0.85em; color:#7f8c8d; text-transform:uppercase; margin-bottom:5px;">${q.question}</div>
            <div style="font-size:1.1em; color:#2c3e50; padding:10px; background:#f8f9fa; border-left:4px solid #3498db; border-radius:4px;">
                ${answersArray[idx] ? answersArray[idx].replace(/\n/g, '<br>') : '<span style="color:#bdc3c7; font-style:italic;">- Keine Angabe -</span>'}
            </div>
        </div>`;
    });
    document.getElementById('view-doc-content').innerHTML = contentHTML;
    document.getElementById('btn-download-doc').onclick = () => downloadPastDocument(currentViewSub);
}

function closeDocModal() { document.getElementById('doc-view-modal').style.display = 'none'; }

// Alte Akte als Word-Datei downloaden
function downloadPastDocument(sub) {
    const base64Data = sub.template.split(',')[1];
    if(!base64Data) return alert("Fehler: Die DOCX-Vorlage existiert nicht mehr.");
    try {
        const zip = new PizZip(base64Data, {base64: true});
        const doc = new window.docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

        const createdDate = new Date(sub.created_at);
        const data = {
            fileNumber: String(sub.id).padStart(4, '0'),
            currentUserName: sub.username,
            generatedDateLong: createdDate.toLocaleDateString('de-DE'),
            generatedTime: createdDate.toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'})
        };
        const answersArray = typeof sub.answers === 'string' ? JSON.parse(sub.answers) : sub.answers;
        answersArray.forEach((ans, idx) => { data[`field-${idx+1}`] = ans; });

        doc.render(data);
        const out = doc.getZip().generate({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
        saveAs(out, `Akte_${String(sub.id).padStart(4,'0')}_${sub.username}.docx`);
    } catch (error) { alert("Fehler beim Erstellen."); }
}

// --- MEETING LOGIK (NEU) ---
// --- MEETING LOGIK (NEU & KUGELSICHER) ---
async function loadMeetingPoints() {
    const res = await fetch(`${API}/meeting`);
    const points = await res.json();
    
    for(let i=1; i<=5; i++) {
        const list = document.getElementById(`list-${i}`);
        if(list) list.innerHTML = '';
    }

    const canManage = currentUser.permissions.includes('manage_meeting') || currentUser.username === 'admin';
    if(document.getElementById('btn-delete-all-meeting')) {
        document.getElementById('btn-delete-all-meeting').style.display = canManage ? 'block' : 'none';
    }

    // BULLETPROOF DESIGN FÜR BUTTONS (Überschreibt alle alten CSS-Fehler)
    const btnStyle = "margin:0; padding:8px 6px; border:none; border-radius:6px; color:white; font-size:0.85em; cursor:pointer; width:auto; white-space:nowrap;";

    points.forEach(pt => {
        const div = document.createElement('div');
        
        let statusClass = '';
        if (pt.status === 'accepted') statusClass = 'item-accepted';
        else if (pt.status === 'rejected') statusClass = 'item-rejected';
        else if (pt.status === 'waiting') statusClass = 'item-waiting';

        div.className = `meeting-item ${statusClass}`;
        
        const dateObj = new Date(pt.created_at);
        const timeStr = dateObj.toLocaleDateString('de-DE') + ' um ' + dateObj.toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'});

        let actionsHTML = '';
        let infoHTML = `<div style="color:#7f8c8d; font-size:0.75em; margin-top:5px;">📅 Erstellt am ${timeStr} von <strong>${pt.created_by}</strong></div>`;

        if (pt.status === 'pending' || !pt.status || pt.status === 'waiting') {
            if (pt.status === 'waiting') {
                infoHTML += `
                <div style="color:#d35400; font-size:0.85em; margin-top:5px; padding:5px; background:rgba(243,156,18,0.1); border-radius:5px;">
                    <strong>⏳ Zurückgestellt von ${pt.managed_by}</strong><br>
                    Grund: ${pt.reason}
                </div>`;
            }

            if (canManage) {
                const waitingBtn = pt.status !== 'waiting' 
                    ? `<button onclick="manageMeetingPoint(${pt.id}, 'waiting')" style="${btnStyle} background:#f39c12; flex:1;">⏳ Warten</button>` 
                    : `<button onclick="manageMeetingPoint(${pt.id}, 'pending')" style="${btnStyle} background:#3498db; flex:1;">↩️ Zurück</button>`;

                actionsHTML = `
                    <div style="display:flex; gap:6px; margin-top:12px; flex-wrap:wrap;">
                        <button onclick="manageMeetingPoint(${pt.id}, 'accepted')" style="${btnStyle} background:#27ae60; flex:1;">✅ Annehmen</button>
                        ${waitingBtn}
                        <button onclick="manageMeetingPoint(${pt.id}, 'rejected')" style="${btnStyle} background:#e74c3c; flex:1;">❌ Ablehnen</button>
                        <button onclick="deleteMeetingPoint(${pt.id})" style="${btnStyle} background:#95a5a6; flex:0 0 auto;">🗑️</button>
                    </div>
                `;
            }
        } 
        else if (pt.status === 'accepted') {
            infoHTML += `<div style="color:#27ae60; font-size:0.85em; margin-top:5px; font-weight:bold;">✅ Angenommen von ${pt.managed_by}</div>`;
            if(canManage) {
                actionsHTML = `
                    <div style="display:flex; gap:6px; margin-top:10px;">
                        <button onclick="manageMeetingPoint(${pt.id}, 'pending')" style="${btnStyle} background:#3498db; flex:0 0 auto;">↩️ Zurücksetzen</button>
                        <button onclick="deleteMeetingPoint(${pt.id})" style="${btnStyle} background:#95a5a6; flex:0 0 auto;">🗑️ Löschen</button>
                    </div>
                `;
            }
        } 
        else if (pt.status === 'rejected') {
            infoHTML += `
                <div style="color:#c0392b; font-size:0.85em; margin-top:5px; padding:5px; background:rgba(231,76,60,0.1); border-radius:5px;">
                    <strong>❌ Abgelehnt von ${pt.managed_by}</strong><br>
                    Grund: ${pt.reason}
                </div>`;
            if(canManage) {
                actionsHTML = `
                    <div style="display:flex; gap:6px; margin-top:10px;">
                        <button onclick="manageMeetingPoint(${pt.id}, 'pending')" style="${btnStyle} background:#3498db; flex:0 0 auto;">↩️ Zurücksetzen</button>
                        <button onclick="deleteMeetingPoint(${pt.id})" style="${btnStyle} background:#95a5a6; flex:0 0 auto;">🗑️ Löschen</button>
                    </div>
                `;
            }
        }

        div.innerHTML = `
            <div class="content-text" style="font-size:1.05em; font-weight:bold; color:#2c3e50;">${pt.content}</div>
            ${infoHTML}
            ${actionsHTML}
        `;

        const list = document.getElementById(`list-${pt.box_id}`);
        if(list) list.appendChild(div);
    });
}

async function addMeetingPoint() {
    const txt = document.getElementById('meeting-text').value;
    const box = document.getElementById('meeting-box-select').value;
    if(!txt) return;

    await fetch(`${API}/meeting`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ content: txt, boxId: box, createdBy: currentUser.username })
    });
    document.getElementById('meeting-text').value = '';
    loadMeetingPoints();
}

async function manageMeetingPoint(id, status) {
    let reason = '';
    
    if (status === 'rejected') {
        reason = prompt("Bitte gib einen Grund für die Ablehnung ein:");
        if (reason === null) return; 
        if (reason.trim() === '') reason = "Kein Grund angegeben"; 
    } else if (status === 'waiting') {
        reason = prompt("Warum wird dieser Punkt zurückgestellt / gewartet?");
        if (reason === null) return; 
        if (reason.trim() === '') reason = "Wartet auf weitere Informationen"; 
    } 
    // Wenn status === 'pending' (Zurücksetzen) wird kein Grund benötigt.

    await fetch(`${API}/meeting/manage`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ id, executedBy: currentUser.username, status, reason })
    });
    loadMeetingPoints();
}

async function deleteMeetingPoint(id) {
    if(!confirm("Wirklich löschen?")) return;
    await fetch(`${API}/meeting/${id}`, {
        method: 'DELETE', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ executedBy: currentUser.username })
    });
    loadMeetingPoints();
}

async function deleteAllMeetingPoints() {
    const confirmation = prompt("⚠️ WARNUNG: Du bist dabei, das KOMPLETTE Board zu leeren!\nBitte tippe 'LÖSCHEN' (alles großgeschrieben) ein, um zu bestätigen:");
    
    if (confirmation !== "LÖSCHEN") {
        if (confirmation !== null) alert("Falsche Eingabe. Vorgang abgebrochen.");
        return; 
    }

    // Geänderter Pfad und POST-Methode, damit der Server es nicht verwechselt
    const res = await fetch(`${API}/meeting-clear`, {
        method: 'POST', 
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ executedBy: currentUser.username })
    });
    
    if (res.ok) {
        alert("Das Board wurde komplett geleert.");
        loadMeetingPoints(); 
    } else {
        alert("Fehler beim Löschen des Boards!");
    }
}

// --- RÄNGE ---
async function loadRanks() {
    const res = await fetch(`${API}/ranks`);
    allRanks = await res.json();
    const container = document.getElementById('ranks-list-container');
    container.innerHTML = allRanks.map((r, index) => {
        const canManage = r.level > currentUser.level || currentUser.rank === 'admin';
        let arrows = '';
        if (canManage) {
            const upBtn = index > 0 ? `<button class="rank-btn" onclick="event.stopPropagation(); moveRank(${index}, -1)">▲</button>` : `<div class="rank-btn" style="opacity:0"></div>`;
            const downBtn = index < allRanks.length - 1 ? `<button class="rank-btn" onclick="event.stopPropagation(); moveRank(${index}, 1)">▼</button>` : `<div class="rank-btn" style="opacity:0"></div>`;
            arrows = `<div class="rank-actions">${upBtn}${downBtn}</div>`;
        }
        const icon = canManage ? '✏️' : '🔒';
        const opacity = canManage ? 1 : 0.6;
        const cursor = canManage ? 'pointer' : 'not-allowed';

        return `<div class="card rank-card" onclick="${canManage ? `editRank('${r.name}')` : ''}" style="border-left:6px solid ${r.color}; cursor:${cursor}; opacity:${opacity}">
             <div style="display:flex; justify-content:space-between; align-items:center;">
                 <div><strong style="font-size:1.1em">${r.name}</strong><br><small style="color:#7f8c8d">Level ${r.level}</small></div>
                 <span style="font-size:1.2em;">${icon}</span>
             </div>${arrows}
        </div>`;
    }).join('');
}
async function moveRank(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= allRanks.length) return;
    const temp = allRanks[index]; allRanks[index] = allRanks[newIndex]; allRanks[newIndex] = temp;
    const rankNames = allRanks.map(r => r.name);
    const res = await fetch(`${API}/ranks/reorder`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ rankNames, executedBy: currentUser.username }) });
    if((await res.json()).error) { alert("Fehler"); loadRanks(); } else { loadRanks(); }
}

function editRank(name) {
    const r = allRanks.find(x => x.name === name);
    if(!r) return;
    document.getElementById('new-rank-name').value = r.name;
    document.getElementById('new-rank-name').disabled = true;
    document.getElementById('new-rank-color').value = r.color;

    const myPerms = currentUser.permissions;
    const isAdmin = currentUser.username === 'admin';
    // Checkboxes setup
    setupCheckbox('perm-docs', 'access_docs', r.permissions, myPerms, isAdmin);
    setupCheckbox('perm-users', 'manage_users', r.permissions, myPerms, isAdmin);
    setupCheckbox('perm-kick', 'kick_users', r.permissions, myPerms, isAdmin);
    setupCheckbox('perm-ranks', 'manage_ranks', r.permissions, myPerms, isAdmin);
    // NEU: Meeting Permissions
    setupCheckbox('perm-meeting', 'access_meeting', r.permissions, myPerms, isAdmin);
    setupCheckbox('perm-meeting-manage', 'manage_meeting', r.permissions, myPerms, isAdmin);

    document.getElementById('btn-save-rank').innerText = "Änderungen speichern";
    document.getElementById('btn-delete-rank').style.display = "block";
    document.getElementById('btn-cancel-rank').style.display = "block";
    document.getElementById('rank-form-container').scrollIntoView({behavior: 'smooth'});
}
function setupCheckbox(elmId, permName, rankPerms, myPerms, isAdmin) {
    const cb = document.getElementById(elmId);
    cb.checked = rankPerms.includes(permName);
    if (!myPerms.includes(permName) && !isAdmin) { cb.disabled = true; cb.parentElement.style.opacity = "0.5"; } else { cb.disabled = false; cb.parentElement.style.opacity = "1"; }
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
    // NEU
    if(document.getElementById('perm-meeting').checked) p.push('access_meeting');
    if(document.getElementById('perm-meeting-manage').checked) p.push('manage_meeting');

    if(!name) return alert('Name fehlt');
    const res = await fetch(`${API}/ranks`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, color, permissions: p, executedBy: currentUser.username }) });
    const d = await res.json(); if(d.error) alert(d.error); else { alert('Gespeichert!'); cancelRankEdit(); loadRanks(); }
}
async function deleteRankTrigger() {
    const name = document.getElementById('new-rank-name').value;
    if(confirm(`Rang "${name}" löschen?`)) {
        const res = await fetch(`${API}/ranks/${name}`, { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ executedBy: currentUser.username }) });
        if((await res.json()).error) alert('Fehler'); else { alert('Gelöscht'); cancelRankEdit(); loadRanks(); }
    }
}
async function loadUsers() { const res = await fetch(`${API}/users`); allUsers = await res.json(); filterUsers(); }
function filterUsers() {
    const t = document.getElementById('user-search').value.toLowerCase();
    document.getElementById('users-list').innerHTML = allUsers.filter(u=>u.username.includes(t)||u.full_name.toLowerCase().includes(t)).map(u => {
        const o = (new Date()-new Date(u.last_seen))<60000;
        return `<div class="card user-card" onclick="openModal('${u.username}')" style="display:flex; justify-content:space-between; align-items:center;"><div><strong>${u.full_name}</strong> <small>(${u.username})</small> <div>${o?'🟢 Online':'⚫ Offline'}</div></div> <span class="badge" style="background:${u.color}">${u.rank}</span></div>`;
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
function closeModal(){document.getElementById('user-modal').style.display='none'}
function showRegister(){document.getElementById('login-screen').style.display='none';document.getElementById('register-screen').style.display='flex'}
function showLogin(){document.getElementById('register-screen').style.display='none';document.getElementById('login-screen').style.display='flex'}
async function register(){ const res = await fetch(`${API}/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.getElementById('reg-user').value,fullName:document.getElementById('reg-name').value,password:document.getElementById('reg-pass').value})}); if(res.ok){alert('Registriert');showLogin()} }
function logout(){location.reload()}

// --- FRAGEBÖGEN & PDF GENERATOR ---
let allForms = [];
let currentFillingForm = null;
let editingFormId = null; // NEU: Speichert, welcher Bogen gerade bearbeitet wird

async function loadForms() {
    const res = await fetch(`${API}/forms`);
    allForms = await res.json();
    
    document.getElementById('forms-list').style.display = 'grid';
    document.getElementById('form-fill-container').style.display = 'none';
    document.getElementById('form-create-container').style.display = 'none';

    // Prüfen, ob der User die Berechtigung hat, Ränge zu verwalten
    const canManageForms = currentUser.permissions.includes('manage_ranks') || currentUser.username === 'admin';

    document.getElementById('forms-list').innerHTML = allForms.map(f => `
        <div class="card" style="border-left:4px solid #3498db; position:relative;">
            <div onclick="openForm(${f.id})" style="cursor:pointer; padding-right:60px;">
                <h3 style="margin-top:0;">${f.title}</h3>
                <small style="color:#7f8c8d;">Erstellt von ${f.created_by}</small><br>
                <small>Enthält ${f.fields.length} Fragen</small>
            </div>
            ${canManageForms ? `
            <div style="position:absolute; top:15px; right:15px; display:flex; flex-direction:column; gap:5px;">
                <button onclick="editForm(${f.id})" style="background:#f39c12; margin:0; padding:6px 10px; width:auto; border:none; border-radius:5px;">✏️</button>
                <button onclick="deleteForm(${f.id})" style="background:#e74c3c; margin:0; padding:6px 10px; width:auto; border:none; border-radius:5px;">🗑️</button>
            </div>
            ` : ''}
        </div>
    `).join('');
}

function showCreateForm() {
    editingFormId = null; // Wir erstellen einen NEUEN Bogen
    document.getElementById('forms-list').style.display = 'none';
    document.getElementById('form-create-container').style.display = 'block';
    document.getElementById('form-fields-builder').innerHTML = ''; 
    document.getElementById('form-title').value = '';
    document.getElementById('form-template').value = '';
    document.getElementById('docx-upload').value = '';
    document.getElementById('upload-success').style.display = 'none';
    document.getElementById('btn-save-form').innerText = "Fragebogen im System speichern";
    addFormField(); 
}

// NEU: Lädt den Bogen in den Editor, wenn man auf den Stift klickt
function editForm(id) {
    const f = allForms.find(x => x.id === id);
    if(!f) return;
    
    editingFormId = id; // Setzt den Modus auf "Bearbeiten"
    document.getElementById('forms-list').style.display = 'none';
    document.getElementById('form-create-container').style.display = 'block';
    
    // Daten einfüllen
    document.getElementById('form-title').value = f.title;
    document.getElementById('form-template').value = f.template;
    document.getElementById('upload-success').style.display = 'block';
    document.getElementById('upload-success').innerText = "✅ Vorlage aus der Datenbank geladen. (Du kannst eine neue hochladen, um sie zu ersetzen)";
    
    // Alte Fragen wiederherstellen
    const container = document.getElementById('form-fields-builder');
    container.innerHTML = '';
    f.fields.forEach((field, i) => {
        const div = document.createElement('div');
        div.className = 'form-field-row';
        div.style = 'display:flex; gap:15px; margin-bottom:15px; align-items:center; background:#f9f9f9; padding:10px; border-radius:8px; border:1px solid #eee;';
        div.innerHTML = `
            <span style="font-weight:bold; color:#e74c3c; width:80px;">{field-${i+1}}</span>
            <input type="text" class="field-question" value="${field.question}" style="flex:1; margin:0;">
            <label style="margin:0; display:flex; align-items:center; gap:5px;"><input type="checkbox" class="field-required" ${field.is_required ? 'checked' : ''}> Pflicht?</label>
        `;
        container.appendChild(div);
    });
    
    document.getElementById('btn-save-form').innerText = "Änderungen speichern";
}

// NEU: Bogen löschen
async function deleteForm(id) {
    if(!confirm("⚠️ Möchtest du diesen Fragebogen wirklich endgültig löschen?")) return;
    await fetch(`${API}/forms/${id}`, {
        method: 'DELETE', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ executedBy: currentUser.username })
    });
    loadForms();
}

function cancelCreateForm() { loadForms(); }

function addFormField() {
    const container = document.getElementById('form-fields-builder');
    const fieldCount = container.children.length + 1;
    const div = document.createElement('div');
    div.className = 'form-field-row';
    div.style = 'display:flex; gap:15px; margin-bottom:15px; align-items:center; background:#f9f9f9; padding:10px; border-radius:8px; border:1px solid #eee;';
    div.innerHTML = `
        <span style="font-weight:bold; color:#e74c3c; width:80px;">{field-${fieldCount}}</span>
        <input type="text" class="field-question" placeholder="Wie lautet die Frage?" style="flex:1; margin:0;">
        <label style="margin:0; display:flex; align-items:center; gap:5px;"><input type="checkbox" class="field-required" checked> Pflicht?</label>
    `;
    container.appendChild(div);
}

// DOCX Upload Handler
function handleDocxUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('form-template').value = e.target.result;
        document.getElementById('upload-success').innerText = "✅ Vorlage erfolgreich eingelesen und bereit!";
        document.getElementById('upload-success').style.display = 'block';
    };
    reader.readAsDataURL(file); 
}

async function saveForm() {
    const title = document.getElementById('form-title').value;
    const template = document.getElementById('form-template').value;
    const questions = document.querySelectorAll('.field-question');
    const requireds = document.querySelectorAll('.field-required');
    
    if(!title || !template) return alert("Titel und DOCX-Vorlage fehlen!");

    const fields = [];
    for(let i=0; i<questions.length; i++) {
        if(questions[i].value.trim() !== '') {
            fields.push({ question: questions[i].value, isRequired: requireds[i].checked });
        }
    }

    try {
        const res = await fetch(`${API}/forms`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            // NEU: Wir senden die ID mit, wenn wir im Bearbeiten-Modus sind
            body: JSON.stringify({ id: editingFormId, title, template, fields, executedBy: currentUser.username })
        });
        
        if (!res.ok) {
            const errorData = await res.json();
            return alert("❌ Fehler vom Server: " + (errorData.error || "Datei eventuell zu groß."));
        }

        alert("✅ Fragebogen erfolgreich im System gespeichert!");
        loadForms(); 
    } catch (e) {
        alert("❌ Kritischer Fehler: " + e.message);
    }
}

function openForm(id) {
    currentFillingForm = allForms.find(f => f.id === id);
    if(!currentFillingForm) return;

    document.getElementById('forms-list').style.display = 'none';
    document.getElementById('form-fill-container').style.display = 'block';
    document.getElementById('fill-form-title').innerText = currentFillingForm.title;

    const container = document.getElementById('fill-form-fields');
    container.innerHTML = currentFillingForm.fields.map((field, index) => `
        <div style="margin-bottom:15px;">
            <label style="font-weight:bold;">${field.question} ${field.is_required ? '<span style="color:red;">*</span>' : ''}</label>
            <textarea id="answer-${index}" class="form-answer" style="min-height:60px;" ${field.is_required ? 'required' : ''}></textarea>
        </div>
    `).join('');
}

function cancelFillForm() { currentFillingForm = null; loadForms(); }

async function submitForm() {
    if(!currentFillingForm) return;

    const answers = [];
    let allValid = true;

    currentFillingForm.fields.forEach((field, index) => {
        const val = document.getElementById(`answer-${index}`).value;
        if(field.is_required && val.trim() === '') allValid = false;
        answers.push(val);
    });

    if(!allValid) return alert("Bitte fülle alle markierten Pflichtfelder aus!");

    const res = await fetch(`${API}/forms/submit`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ formId: currentFillingForm.id, username: currentUser.username, answers })
    });
    const d = await res.json();
    
    if(d.success) {
        generateDocument(answers, d.submissionId);
        alert("Dokument wurde in der Akte gespeichert und wird heruntergeladen!");
        cancelFillForm();
    }
}

// 🪄 MAGIC: WORD-DATEI PERFEKT AUSFÜLLEN 🪄
function generateDocument(answers, submissionId) {
    // 1. Gespeicherte Word-Datei laden
    const base64Data = currentFillingForm.template.split(',')[1];
    if(!base64Data) return alert("Fehler: Keine gültige Vorlage gefunden.");

    try {
        // 2. Datei im Arbeitsspeicher öffnen
        const zip = new PizZip(base64Data, {base64: true});
        const doc = new window.docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
        });

        // 3. Platzhalter definieren
        const data = {
            fileNumber: String(submissionId).padStart(4, '0'),
            currentUserName: currentUser.username,
            generatedDateLong: new Date().toLocaleDateString('de-DE'),
            generatedTime: new Date().toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'})
        };

        // Antworten als {field-1}, {field-2} usw. einfügen
        answers.forEach((ans, idx) => {
            data[`field-${idx+1}`] = ans; 
        });

        // 4. Word-Datei ausfüllen
        doc.render(data);

        // 5. Fertige Datei erzeugen
        const out = doc.getZip().generate({
            type: "blob",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        
        // 6. Automatisch herunterladen
        saveAs(out, `Akte_${String(submissionId).padStart(4,'0')}_${currentUser.username}.docx`);
    } catch (error) {
        console.error(error);
        alert("Fehler beim Erstellen des Dokuments. Sind die {Klammern} in der Word-Datei richtig gesetzt?");
    }
}