const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('./database');

async function getExecutorData(username) {
    const res = await pool.query(`SELECT u.username, r.level, r.permissions FROM users u LEFT JOIN ranks r ON u.rank = r.name WHERE u.username = $1`, [username]);
    if (res.rows.length === 0) return null;
    const data = res.rows[0];
    return { username: data.username, level: data.level || 99, permissions: data.permissions ? JSON.parse(data.permissions) : [] };
}

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(`SELECT u.*, r.permissions, r.color, r.level FROM users u LEFT JOIN ranks r ON u.rank = r.name WHERE u.username = $1`, [username]);
        const user = result.rows[0];
        if (user && await bcrypt.compare(password, user.password_hash)) {
            if (user.banned_until && new Date(user.banned_until) > new Date()) {
                const rem = Math.ceil((new Date(user.banned_until) - new Date()) / 1000);
                return res.status(403).json({ error: 'banned', remainingSeconds: rem });
            }
            await pool.query('UPDATE users SET last_seen = NOW(), force_logout = false WHERE id = $1', [user.id]);
            res.json({ success: true, user: { 
                username: user.username, rank: user.rank, fullName: user.full_name,
                permissions: JSON.parse(user.permissions || '[]'), color: user.color, level: user.level || 99
            }});
        } else { res.status(401).json({ error: 'Falsche Daten' }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/heartbeat', async (req, res) => {
    const { username } = req.body;
    if(!username) return res.sendStatus(400);
    await pool.query('UPDATE users SET last_seen = NOW() WHERE username = $1', [username]);
    const result = await pool.query('SELECT force_logout, kick_message, kicked_by, banned_until FROM users WHERE username = $1', [username]);
    const u = result.rows[0];
    if (u && (u.force_logout || (u.banned_until && new Date(u.banned_until) > new Date()))) return res.json({ kicked: true, reason: u.kick_message, by: u.kicked_by });
    res.json({ ok: true });
});

// --- MEETING API (NEU) ---
router.get('/meeting', async (req, res) => {
    const result = await pool.query('SELECT * FROM meeting_points ORDER BY created_at DESC');
    res.json(result.rows);
});

router.post('/meeting', async (req, res) => {
    const { content, boxId, createdBy } = req.body;
    await pool.query('INSERT INTO meeting_points (content, box_id, created_by, status) VALUES ($1, $2, $3, $4)', [content, boxId, createdBy, 'pending']);
    res.json({ success: true });
});

router.post('/meeting/manage', async (req, res) => {
    const { id, executedBy, status, reason } = req.body;
    const user = await getExecutorData(executedBy);
    
    if (!user || (!user.permissions.includes('manage_meeting') && user.username !== 'admin')) {
        return res.status(403).json({ error: 'Keine Berechtigung.' });
    }

    await pool.query(
        'UPDATE meeting_points SET status = $1, managed_by = $2, reason = $3 WHERE id = $4', 
        [status, executedBy, reason || null, id]
    );
    res.json({ success: true });
});

router.delete('/meeting/:id', async (req, res) => {
    const { id, executedBy } = req.body; // executedBy muss im Body sein (nicht Params) für DELETE Requests mit Body
    // Express DELETE Body ist tricky, nutzen wir lieber POST für delete oder query params, aber hier einfachheitshalber:
    // Wir nehmen an, der Client sendet JSON Body.
    // Falls DELETE Body nicht klappt, ändern wir client.js auf POST /meeting/delete. Aber Standard-Fetch kann das.
    
    const user = await getExecutorData(req.body.executedBy); 
    if (!user || (!user.permissions.includes('manage_meeting') && user.username !== 'admin')) {
         return res.status(403).json({ error: 'Keine Berechtigung zum Löschen.' });
    }
    await pool.query('DELETE FROM meeting_points WHERE id = $1', [req.params.id]);
    res.json({ success: true });
});

// --- RÄNGE ---
router.get('/ranks', async (req, res) => {
    const result = await pool.query('SELECT * FROM ranks ORDER BY level ASC'); 
    res.json(result.rows.map(r => ({ ...r, permissions: JSON.parse(r.permissions || '[]') })));
});
router.post('/ranks', async (req, res) => {
    const { name, color, permissions, executedBy } = req.body;
    const ex = await getExecutorData(executedBy);
    if(!ex) return res.status(403).json({error:'User error'});
    
    const targetRes = await pool.query('SELECT level FROM ranks WHERE name = $1', [name]);
    if(targetRes.rows.length > 0) {
        if(targetRes.rows[0].level <= ex.level && ex.username !== 'admin') return res.status(403).json({error:'Rang zu hoch.'});
    }
    await pool.query(`INSERT INTO ranks (name, color, permissions, level) VALUES ($1, $2, $3, 99) ON CONFLICT (name) DO UPDATE SET color = $2, permissions = $3`, [name, color, JSON.stringify(permissions)]);
    res.json({ success: true });
});
router.post('/ranks/reorder', async (req, res) => {
    const { rankNames, executedBy } = req.body;
    const ex = await getExecutorData(executedBy);
    if(!ex) return res.status(403).json({error:'User error'});
    try {
        const currentRanks = (await pool.query('SELECT name, level FROM ranks')).rows;
        for(let i=0; i<rankNames.length; i++) {
            const name = rankNames[i]; const newLevel = i+1;
            const old = currentRanks.find(r=>r.name===name);
            if(old && old.level !== newLevel) {
                if(old.level <= ex.level && ex.username !== 'admin') return res.status(403).json({error:`Rang ${name} darf nicht verschoben werden.`});
                if(newLevel <= ex.level && ex.username !== 'admin') return res.status(403).json({error:`Ziel-Level ${newLevel} zu hoch.`});
            }
            await pool.query('UPDATE ranks SET level = $1 WHERE name = $2', [newLevel, name]);
        }
        res.json({success:true});
    } catch(e) { res.status(500).json({error:e.message}); }
});
router.delete('/ranks/:name', async (req, res) => {
    if(req.params.name==='admin') return res.status(403).json({error:'Verboten'});
    const ex = await getExecutorData(req.body.executedBy);
    const t = await pool.query('SELECT level FROM ranks WHERE name = $1', [req.params.name]);
    if(t.rows.length>0 && t.rows[0].level <= ex.level && ex.username !== 'admin') return res.status(403).json({error:'Zu hoch.'});
    await pool.query('DELETE FROM ranks WHERE name = $1', [req.params.name]);
    await pool.query("UPDATE users SET rank = 'besucher' WHERE rank = $1", [req.params.name]);
    res.json({success:true});
});

// REST
router.post('/register', async (req, res) => {
    try { await pool.query('INSERT INTO users (username, password_hash, full_name) VALUES ($1, $2, $3)', [req.body.username, await bcrypt.hash(req.body.password,10), req.body.fullName]); res.json({success:true}); } catch(e){res.status(400).json({error:'Vergeben'});}
});
router.post('/documents', async (req, res) => { await pool.query('INSERT INTO documents (title, content, created_by) VALUES ($1, $2, $3)', [req.body.title, req.body.content, req.body.createdBy]); res.json({success:true}); });
router.get('/documents', async (req, res) => { const r = await pool.query('SELECT * FROM documents ORDER BY created_at DESC'); res.json(r.rows); });
router.get('/users', async (req, res) => { const r = await pool.query('SELECT u.id, u.username, u.full_name, u.rank, u.last_seen, r.color FROM users u LEFT JOIN ranks r ON u.rank = r.name ORDER BY u.id ASC'); res.json(r.rows); });
router.post('/users/rank', async (req, res) => { await pool.query('UPDATE users SET rank = $1 WHERE username = $2', [req.body.newRank, req.body.username]); res.json({success:true}); });
router.post('/users/kick', async (req, res) => { 
    let d = null; if(req.body.isBan && req.body.minutes>0) d = new Date(Date.now()+req.body.minutes*60000);
    await pool.query(`UPDATE users SET banned_until=$1, force_logout=true, kick_message=$2, kicked_by=$3 WHERE username=$4`, [d, req.body.reason, req.body.adminName, req.body.username]);
    res.json({success:true});
});

module.exports = router;