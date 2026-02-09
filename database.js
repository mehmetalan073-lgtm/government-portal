const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
    console.log('🔄 Datenbank-Update...');
    const client = await pool.connect();
    try {
        // Tabellen erstellen
        await client.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY, 
            username TEXT UNIQUE NOT NULL, 
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL, 
            rank TEXT DEFAULT 'besucher', 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            banned_until TIMESTAMP, 
            last_seen TIMESTAMP
        );`);

        await client.query(`CREATE TABLE IF NOT EXISTS documents (
            id SERIAL PRIMARY KEY, title TEXT NOT NULL, content TEXT,
            created_by TEXT REFERENCES users(username), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);

        await client.query(`CREATE TABLE IF NOT EXISTS ranks (
            name TEXT PRIMARY KEY, color TEXT NOT NULL, permissions TEXT DEFAULT '[]'
        );`);

        // --- ADMIN UPDATE ---
        // Admin bekommt jetzt auch 'kick_users' Recht
        await client.query("DELETE FROM ranks WHERE name = 'admin'");
        
        const adminPerms = JSON.stringify(['access_docs', 'manage_users', 'manage_ranks', 'kick_users']);
        await client.query(`
            INSERT INTO ranks (name, color, permissions) 
            VALUES ($1, $2, $3)
        `, ['admin', '#e74c3c', adminPerms]);

        // Andere Ränge (Standard)
        const otherRanks = [
            ['nc-team', '#e67e22', JSON.stringify(['access_docs', 'manage_users', 'kick_users'])],
            ['user', '#3498db', JSON.stringify(['access_docs'])],
            ['besucher', '#95a5a6', JSON.stringify([])]
        ];
        
        for (const [name, color, perms] of otherRanks) {
            await client.query(`
                INSERT INTO ranks (name, color, permissions) VALUES ($1, $2, $3) 
                ON CONFLICT (name) DO NOTHING
            `, [name, color, perms]);
        }

        // Admin User sicherstellen
        const hash = await bcrypt.hash('memo', 10);
        await client.query(`
            INSERT INTO users (username, password_hash, full_name, rank)
            VALUES ($1, $2, $3, 'admin')
            ON CONFLICT (username) 
            DO UPDATE SET password_hash = $2, rank = 'admin'
        `, ['admin', hash, 'System Administrator']);
        
        console.log('✅ Datenbank bereit.');
    } catch (err) {
        console.error('❌ DB Fehler:', err);
    } finally {
        client.release();
    }
}

module.exports = { pool, initDB };