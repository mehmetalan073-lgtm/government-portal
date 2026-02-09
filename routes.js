const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('./database');

// --- AUTHENTIFIZIERUNG ---

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (user && await bcrypt.compare(password, user.password_hash)) {
            res.json({ success: true, user: { username: user.username, rank: user.rank, fullName: user.full_name } });
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

// --- DOKUMENTE & USER ---

router.get('/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, full_name, rank FROM users ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

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

// --- RANG FARBEN (NEU) ---

router.get('/rank-colors', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM rank_colors');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/rank-colors', async (req, res) => {
    const { rank, color } = req.body;
    try {
        await pool.query(`
            INSERT INTO rank_colors (rank_name, color_hex) 
            VALUES ($1, $2)
            ON CONFLICT (rank_name) DO UPDATE SET color_hex = $2
        `, [rank, color]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;