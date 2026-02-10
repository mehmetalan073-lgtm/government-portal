const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('./database');

// Hilfsfunktion: Prüfen ob User Rechte hat
async function getExecutorData(username) {
    const res = await pool.query(`
        SELECT u.username, r.level, r.permissions 
        FROM users u 
        LEFT JOIN ranks r ON u.rank = r.name 
        WHERE u.username = $1
    `, [username]);
    
    if (res.rows.length === 0) return null;
    
    const data = res.rows[0];
    return {
        username: data.username,
        level: data.level || 99,
        permissions: data.permissions ? JSON.parse(data.permissions) : []
    };
}

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
    const result = await pool.query('SELECT * FROM ranks ORDER BY level ASC'); 
    res.json(result.rows.map(r => ({ ...r, permissions: JSON.parse(r.permissions || '[]') })));
});

// RANK ERSTELLEN / BEARBEITEN (Mit Sicherheits-Check)
router.post('/ranks', async (req, res) => {
    const { name, color, permissions, executedBy } = req.body; // executedBy muss vom Client kommen!
    
    // 1. Wer führt das aus?
    const executor = await getExecutorData(executedBy);
    if (!executor) return res.status(403).json({ error: "User nicht gefunden." });

    // 2. Ziel-Rang prüfen (existiert er schon?)
    const targetRankRes = await pool.query('SELECT level FROM ranks WHERE name = $1', [name]);
    const targetExists = targetRankRes.rows.length > 0;
    
    if (targetExists) {
        const targetLevel = targetRankRes.rows[0].level;
        // REGEL: Man darf nichts bearbeiten, was kleiner oder gleich dem eigenen Level ist.
        // Ausnahme: Der 'admin' User darf alles (oder wir lassen das weg für strikte Logik)
        if (targetLevel <= executor.level && executor.username !== 'admin') {
            return res.status(403).json({ error: "Du kannst diesen Rang nicht bearbeiten (Level zu hoch)." });
        }
    }

    // 3. Rechte-Check: Darf ich Rechte vergeben, die ich selbst nicht habe?
    // Wir prüfen jedes angefragte Recht.
    for (const perm of permissions) {
        if (!executor.permissions.includes(perm) && executor.username !== 'admin') {
            return res.status(403).json({ error: `Du kannst das Recht '${perm}' nicht vergeben, da du es selbst nicht hast.` });
        }
    }

    // Speichern (Level wird beim Update nicht geändert, nur Farbe/Rechte. Neue Ränge kriegen 99)
    await pool.query(`
        INSERT INTO ranks (name, color, permissions, level) VALUES ($1, $2, $3, 99)
        ON CONFLICT (name) DO UPDATE SET color = $2, permissions = $3
    `, [name, color, JSON.stringify(permissions)]);
    
    res.json({ success: true });
});

// REIHENFOLGE ÄNDERN (Mit Sicherheits-Check)
router.post('/ranks/reorder', async (req, res) => {
    const { rankNames, executedBy } = req.body;
    
    const executor = await getExecutorData(executedBy);
    if (!executor) return res.status(403).json({ error: "User error." });

    try {
        // Wir müssen sicherstellen, dass KEIN Rang, der mächtiger/gleich dem Executor ist, verschoben wurde.
        // Wir holen die aktuelle Liste aus der DB.
        const currentRanksRes = await pool.query('SELECT name, level FROM ranks');
        const currentRanks = currentRanksRes.rows;

        for (let i = 0; i < rankNames.length; i++) {
            const name = rankNames[i];
            const newLevel = i + 1; // Das neue Level basierend auf Position
            
            // Finde den alten Rang in der DB
            const oldRankData = currentRanks.find(r => r.name === name);
            if (!oldRankData) continue; 

            // Wenn sich das Level ändern würde...
            if (oldRankData.level !== newLevel) {
                // REGEL: Ich darf Ränge, die <= meinem Level sind, NICHT bewegen.
                if (oldRankData.level <= executor.level && executor.username !== 'admin') {
                    return res.status(403).json({ error: `Du darfst den Rang '${name}' nicht verschieben.` });
                }
                
                // REGEL: Ich darf keinen Rang AUF eine Position schieben, die <= meinem Level ist.
                // (Also ich darf niemanden über mich befördern)
                if (newLevel <= executor.level && executor.username !== 'admin') {
                     return res.status(403).json({ error: `Du kannst niemanden auf Level ${newLevel} befördern (Du bist ${executor.level}).` });
                }
            }

            // Wenn alles okay ist, Update
            await pool.query('UPDATE ranks SET level = $1 WHERE name = $2', [newLevel, name]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/ranks/:name', async (req, res) => {
    const { name } = req.params;
    const { executedBy } = req.body;

    if(name === 'admin') return res.status(403).json({error:'Verboten'});

    const executor = await getExecutorData(executedBy);
    const targetRes = await pool.query('SELECT level FROM ranks WHERE name = $1', [name]);
    
    if(targetRes.rows.length > 0) {
        const targetLevel = targetRes.rows[0].level;
        if (targetLevel <= executor.level && executor.username !== 'admin') {
            return res.status(403).json({ error: 'Rang zu hoch, kann nicht gelöscht werden.' });
        }
    }

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
    // Hier müsste man eigentlich auch prüfen, ob man den Rang vergeben darf!
    // Für dieses Beispiel lassen wir es simpel, aber in Zukunft: Level Check!
    await pool.query('UPDATE users SET rank = $1 WHERE username = $2', [req.body.newRank, req.body.username]);
    res.json({ success: true });
});
router.post('/users/kick', async (req, res) => {
    const { username, minutes, reason, adminName, isBan } = req.body;
    // Auch hier: Man sollte eigentlich niemanden kicken dürfen, der über einem steht.
    let bannedUntil = null;
    if (isBan && minutes > 0) bannedUntil = new Date(Date.now() + minutes * 60000);
    await pool.query(`UPDATE users SET banned_until = $1, force_logout = true, kick_message = $2, kicked_by = $3 WHERE username = $4`, [bannedUntil, reason, adminName, username]);
    res.json({ success: true });
});

module.exports = router;