const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('./database');

// --- AUTH & LOGIN ---

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(`
            SELECT u.*, r.permissions, r.color 
            FROM users u 
            LEFT JOIN ranks r ON u.rank = r.name 
            WHERE u.username = $1
        `, [username]);
        
        const user = result.rows[0];

        if (user && await bcrypt.compare(password, user.password_hash)) {
            // 1. PRÜFEN OB GEBANNT
            if (user.banned_until && new Date(user.banned_until) > new Date()) {
                return res.status(403).json({ 
                    error: 'banned', 
                    bannedUntil: user.banned_until 
                });
            }

            // 2. Online Status setzen
            await pool.query('UPDATE users SET last_seen = NOW() WHERE id = $1', [user.id]);

            res.json({ 
                success: true, 
                user: { 
                    username: user.username, 
                    rank: user.rank, 
                    fullName: user.full_name,
                    permissions: user.permissions ? JSON.parse(user.permissions) : [],
                    color: user.color
                } 
            });
        } else {
            res.status(401).json({ error: 'Falsche Daten' });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/heartbeat', async (req, res) => {
    const { username } = req.body;
    if(!username) return res.sendStatus(400);
    // Aktualisiert "Zuletzt gesehen"
    await pool.query('UPDATE users SET last_seen = NOW() WHERE username = $1', [username]);
    
    // Prüfen ob User inzwischen gekickt wurde (Session Kill)
    const result = await pool.query('SELECT banned_until FROM users WHERE username = $1', [username]);
    if (result.rows[0]?.banned_until && new Date(result.rows[0].banned_until) > new Date()) {
        return res.json({ kicked: true, bannedUntil: result.rows[0].banned_until });
    }
    res.json({ ok: true });
});

router.post('/register', async (req, res) => {
    const { username, password, fullName } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password_hash, full_name) VALUES ($1, $2, $3)', 
            [username, hash, fullName]);
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: 'Username vergeben' }); }
});

// --- DOKUMENTE ---

router.post('/documents', async (req, res) => {
    const { title, content, createdBy } = req.body;
    try {
        await pool.query('INSERT INTO documents (title, content, created_by) VALUES ($1, $2, $3)', [title, content, createdBy]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/documents', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM documents ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- USER & KICK SYSTEM ---

router.get('/users', async (req, res) => {
    try {
        // Wir holen last_seen dazu
        const result = await pool.query(`
            SELECT u.id, u.username, u.full_name, u.rank, u.last_seen, u.banned_until, r.color 
            FROM users u
            LEFT JOIN ranks r ON u.rank = r.name
            ORDER BY u.id ASC
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/users/rank', async (req, res) => {
    const { username, newRank } = req.body;
    try {
        await pool.query('UPDATE users SET rank = $1 WHERE username = $2', [newRank, username]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/users/kick', async (req, res) => {
    const { username, minutes } = req.body;
    try {
        // Berechne Zeit in der Zukunft
        const bannedUntil = new Date(Date.now() + minutes * 60000);
        await pool.query('UPDATE users SET banned_until = $1 WHERE username = $2', [bannedUntil, username]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- RÄNGE ---

router.get('/ranks', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ranks ORDER BY name ASC');
        const ranks = result.rows.map(r => ({ ...r, permissions: JSON.parse(r.permissions || '[]') }));
        res.json(ranks);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ranks', async (req, res) => {
    const { name, color, permissions } = req.body;
    try {
        await pool.query(`
            INSERT INTO ranks (name, color, permissions) VALUES ($1, $2, $3)
            ON CONFLICT (name) DO UPDATE SET color = $2, permissions = $3
        `, [name, color, JSON.stringify(permissions)]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/ranks/:name', async (req, res) => {
    const { name } = req.params;
    if(name === 'admin') return res.status(403).json({ error: 'Verboten' });
    try {
        await pool.query('DELETE FROM ranks WHERE name = $1', [name]);
        await pool.query("UPDATE users SET rank = 'besucher' WHERE rank = $1", [name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;