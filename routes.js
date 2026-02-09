const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('./database');

// ... (Hier bleiben deine Login/Register/Dokumente Routen unverändert) ...
// ... (Füge das hier UNTER den bestehenden Code, aber VOR module.exports ein) ...

// --- RANG FARBEN ---

// Farben abrufen
router.get('/rank-colors', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM rank_colors');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Farben speichern (Nur Admin)
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