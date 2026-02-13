const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
    console.log('🔄 Datenbank Update (Meeting-System)...');
    const client = await pool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL, rank TEXT DEFAULT 'besucher', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            banned_until TIMESTAMP, last_seen TIMESTAMP, kick_message TEXT, kicked_by TEXT, force_logout BOOLEAN DEFAULT FALSE
        );`);

        await client.query(`CREATE TABLE IF NOT EXISTS documents (
            id SERIAL PRIMARY KEY, title TEXT NOT NULL, content TEXT,
            created_by TEXT REFERENCES users(username), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);

        await client.query(`CREATE TABLE IF NOT EXISTS ranks (
            name TEXT PRIMARY KEY, color TEXT NOT NULL, permissions TEXT DEFAULT '[]', level INTEGER DEFAULT 99
        );`);

        // NEU: Tabelle für Besprechungspunkte
        await client.query(`CREATE TABLE IF NOT EXISTS meeting_points (
            id SERIAL PRIMARY KEY,
            content TEXT NOT NULL,
            box_id INTEGER NOT NULL,  -- 1 bis 4
            is_done BOOLEAN DEFAULT FALSE,
            created_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);

        // Spalten sicherstellen (falls DB schon existiert)
        await client.query("ALTER TABLE ranks ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 99");

        // Admin Rechte Update (Neue Rechte hinzufügen)
        const adminPerms = JSON.stringify(['access_docs', 'manage_users', 'manage_ranks', 'kick_users', 'access_meeting', 'manage_meeting']);
        await client.query(`
            INSERT INTO ranks (name, color, permissions, level) VALUES ($1, $2, $3, 1)
            ON CONFLICT (name) DO UPDATE SET permissions = $3, level = 1
        `, ['admin', '#e74c3c', adminPerms]);

        // Standard Ränge
        const otherRanks = [
            ['nc-team', '#e67e22', JSON.stringify(['access_docs', 'manage_users', 'kick_users', 'access_meeting']), 2],
            ['user', '#3498db', JSON.stringify(['access_docs']), 3],
            ['besucher', '#95a5a6', JSON.stringify([]), 99]
        ];
        
        for (const [name, color, perms, lvl] of otherRanks) {
            await client.query(`
                INSERT INTO ranks (name, color, permissions, level) VALUES ($1, $2, $3, $4) 
                ON CONFLICT (name) DO NOTHING
            `, [name, color, perms, lvl]);
        }

        const hash = await bcrypt.hash('memo', 10);
        await client.query(`
            INSERT INTO users (username, password_hash, full_name, rank) VALUES ($1, $2, $3, 'admin')
            ON CONFLICT (username) DO NOTHING
        `, ['admin', hash, 'System Administrator']);
        
        console.log('✅ Datenbank bereit.');
    } catch (err) { console.error('❌ DB Fehler:', err); } finally { client.release(); }
}

module.exports = { pool, initDB };