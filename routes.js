const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('./database');

// --- AUTH ---

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        // Wir holen den User UND seine Rang-Rechte in einem Abwasch
        const result = await pool.query(`
            SELECT u.*, r.permissions, r.color 
            FROM users u 
            LEFT JOIN ranks r ON u.rank = r.name 
            WHERE u.username = $1
        `, [username]);
        
        const user = result.rows[0];

        if (user && await bcrypt.compare(password, user.password_hash)) {
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
        await pool.query('INSERT INTO documents (title, content, created_by) VALUES ($1, $2, $3)', 
            [title, content, createdBy]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/documents', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM documents ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- USER MANAGEMENT ---

router.get('/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, full_name, rank FROM users ORDER BY id DESC');
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

// --- RÄNGE & RECHTE MANAGEMENT ---

router.get('/ranks', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ranks ORDER BY name ASC');
        // Permissions String zu JSON parsen für das Frontend
        const ranks = result.rows.map(r => ({
            ...r,
            permissions: JSON.parse(r.permissions || '[]')
        }));
        res.json(ranks);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ranks', async (req, res) => {
    const { name, color, permissions } = req.body; // permissions ist ein Array ['access_docs', ...]
    try {
        await pool.query(`
            INSERT INTO ranks (name, color, permissions) 
            VALUES ($1, $2, $3)
            ON CONFLICT (name) DO UPDATE SET 
                color = $2, 
                permissions = $3
        `, [name, color, JSON.stringify(permissions)]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/ranks/:name', async (req, res) => {
    const { name } = req.params;
    if(name === 'admin') return res.status(403).json({ error: 'Admin Rang kann nicht gelöscht werden' });
    try {
        await pool.query('DELETE FROM ranks WHERE name = $1', [name]);
        // User mit diesem Rang auf 'besucher' zurücksetzen
        await pool.query("UPDATE users SET rank = 'besucher' WHERE rank = $1", [name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;