const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
    console.log('🔄 Datenbank Hard-Reset & Initialisierung...');
    const client = await pool.connect();
    try {
        // ⚠️ WICHTIG: Alte Tabellen löschen, um Schema-Fehler zu beheben
        // Das stellt sicher, dass 'last_seen' und 'banned_until' wirklich existieren
        await client.query("DROP TABLE IF EXISTS documents CASCADE");
        await client.query("DROP TABLE IF EXISTS ranks CASCADE");
        await client.query("DROP TABLE IF EXISTS users CASCADE");
        await client.query("DROP TABLE IF EXISTS rank_colors CASCADE"); // Reste aufräumen

        // 1. Tabellen neu erstellen (jetzt mit allen Spalten!)
        await client.query(`CREATE TABLE users (
            id SERIAL PRIMARY KEY, 
            username TEXT UNIQUE NOT NULL, 
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL, 
            rank TEXT DEFAULT 'besucher', 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            banned_until TIMESTAMP, 
            last_seen TIMESTAMP
        )`);

        await client.query(`CREATE TABLE documents (
            id SERIAL PRIMARY KEY, title TEXT NOT NULL, content TEXT,
            created_by TEXT REFERENCES users(username), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE ranks (
            name TEXT PRIMARY KEY, color TEXT NOT NULL, permissions TEXT DEFAULT '[]'
        )`);

        // 2. Admin Rang erstellen
        const adminPerms = JSON.stringify(['access_docs', 'manage_users', 'manage_ranks', 'kick_users']);
        await client.query(`INSERT INTO ranks (name, color, permissions) VALUES ($1, $2, $3)`, 
            ['admin', '#e74c3c', adminPerms]);

        // 3. Andere Ränge
        const otherRanks = [
            ['nc-team', '#e67e22', JSON.stringify(['access_docs', 'manage_users', 'kick_users'])],
            ['user', '#3498db', JSON.stringify(['access_docs'])],
            ['besucher', '#95a5a6', JSON.stringify([])]
        ];
        for (const [name, color, perms] of otherRanks) {
            await client.query(`INSERT INTO ranks (name, color, permissions) VALUES ($1, $2, $3)`, 
                [name, color, perms]);
        }

        // 4. Admin User erstellen
        const hash = await bcrypt.hash('memo', 10);
        await client.query(`
            INSERT INTO users (username, password_hash, full_name, rank)
            VALUES ($1, $2, $3, 'admin')
        `, ['admin', hash, 'System Administrator']);
        
        console.log('✅ Datenbank komplett neu aufgesetzt (inkl. neuer Spalten).');
    } catch (err) {
        console.error('❌ DB Initialisierungs-Fehler:', err);
    } finally {
        client.release();
    }
}

module.exports = { pool, initDB };