const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('./database');

// --- LOGIN ---
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(`SELECT u.*, r.permissions, r.color, r.level FROM users u LEFT JOIN ranks r ON u.rank = r.name WHERE u.username = $1`, [username]);
        const user = result.rows[0];

        if (user && await bcrypt.compare(password, user.password_hash)) {
            if (user.banned_until) {
                const now = new Date();
                const bannedUntil = new Date(user.banned_until);
                if (bannedUntil > now) {
                    const remainingSeconds = Math.ceil((bannedUntil - now) / 1000);
                    return res.status(403).json({ error: 'banned', bannedUntil: user.banned_until, remainingSeconds });
                }
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
    if (u && (u.force_logout || (u.banned_until && new Date(u.banned_until) > new Date()))) {
        return res.json({ kicked: true, reason: u.kick_message, by: u.kicked_by });
    }
    res.json({ ok: true });
});

// --- RÄNGE ---
router.get('/ranks', async (req, res) => {
    // Sortiert nach Level aufsteigend (1 ist wichtig, 99 unwichtig)
    const result = await pool.query('SELECT * FROM ranks ORDER BY level ASC'); 
    res.json(result.rows.map(r => ({ ...r, permissions: JSON.parse(r.permissions || '[]') })));
});

router.post('/ranks', async (req, res) => {
    const { name, color, permissions } = req.body;
    // Neue Ränge bekommen erstmal Level 99 (ganz hinten), bis sie sortiert werden
    await pool.query(`
        INSERT INTO ranks (name, color, permissions, level) VALUES ($1, $2, $3, 99)
        ON CONFLICT (name) DO UPDATE SET color = $2, permissions = $3
    `, [name, color, JSON.stringify(permissions)]);
    res.json({ success: true });
});

// NEU: Reihenfolge speichern
router.post('/ranks/reorder', async (req, res) => {
    const { rankNames } = req.body; // Array mit Namen in neuer Reihenfolge: ['admin', 'chef', 'user']
    
    // Wir gehen durch die Liste und geben jedem Rang seinen Index als Level
    // Index 0 (erster) wird Level 1
    // Index 1 (zweiter) wird Level 2 ...
    try {
        for (let i = 0; i < rankNames.length; i++) {
            const level = i + 1;
            const name = rankNames[i];
            await pool.query('UPDATE ranks SET level = $1 WHERE name = $2', [level, name]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/ranks/:name', async (req, res) => {
    const { name } = req.params;
    if(name === 'admin') return res.status(403).json({error:'Verboten'});
    await pool.query('DELETE FROM ranks WHERE name = $1', [name]);
    await pool.query("UPDATE users SET rank = 'besucher' WHERE rank = $1", [name]);
    res.json({ success: true });
});

// --- REST ---
router.post('/register', async (req, res) => {
    const { username, password, fullName } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password_hash, full_name) VALUES ($1, $2, $3)', [username, hash, fullName]);
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: 'Username vergeben' }); }
});
router.post('/documents', async (req, res) => {
    const { title, content, createdBy } = req.body;
    await pool.query('INSERT INTO documents (title, content, created_by) VALUES ($1, $2, $3)', [title, content, createdBy]);
    res.json({ success: true });
});
router.get('/documents', async (req, res) => {
    const result = await pool.query('SELECT * FROM documents ORDER BY created_at DESC');
    res.json(result.rows);
});
router.get('/users', async (req, res) => {
    const result = await pool.query('SELECT u.id, u.username, u.full_name, u.rank, u.last_seen, r.color FROM users u LEFT JOIN ranks r ON u.rank = r.name ORDER BY u.id ASC');
    res.json(result.rows);
});
router.post('/users/rank', async (req, res) => {
    await pool.query('UPDATE users SET rank = $1 WHERE username = $2', [req.body.newRank, req.body.username]);
    res.json({ success: true });
});
router.post('/users/kick', async (req, res) => {
    const { username, minutes, reason, adminName, isBan } = req.body;
    let bannedUntil = null;
    if (isBan && minutes > 0) bannedUntil = new Date(Date.now() + minutes * 60000);
    await pool.query(`UPDATE users SET banned_until = $1, force_logout = true, kick_message = $2, kicked_by = $3 WHERE username = $4`, [bannedUntil, reason, adminName, username]);
    res.json({ success: true });
});

module.exports = router;