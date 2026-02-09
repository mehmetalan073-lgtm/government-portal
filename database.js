const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
    console.log('🔄 Prüfe Datenbank...');
    const client = await pool.connect();
    try {
        // 1. Tabellen sicherstellen (NUR WENN NICHT EXISTENT)
        // Wir nutzen "IF NOT EXISTS", damit bestehende Daten bleiben!
        
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

        // 2. Admin-Rechte sicherstellen (Ohne Daten zu löschen)
        // Wir aktualisieren nur die Rechte des Admins, falls sie fehlen
        const adminPerms = JSON.stringify(['access_docs', 'manage_users', 'manage_ranks', 'kick_users']);
        
        await client.query(`
            INSERT INTO ranks (name, color, permissions) 
            VALUES ($1, $2, $3)
            ON CONFLICT (name) DO UPDATE SET permissions = $3
        `, ['admin', '#e74c3c', adminPerms]);

        // 3. Standard-Ränge (nur wenn sie fehlen)
        const otherRanks = [
            ['nc-team', '#e67e22', JSON.stringify(['access_docs', 'manage_users', 'kick_users'])],
            ['user', '#3498db', JSON.stringify(['access_docs'])],
            ['besucher', '#95a5a6', JSON.stringify([])]
        ];
        
        for (const [name, color, perms] of otherRanks) {
            await client.query(`
                INSERT INTO ranks (name, color, permissions) 
                VALUES ($1, $2, $3) 
                ON CONFLICT (name) DO NOTHING
            `, [name, color, perms]);
        }

        // 4. Admin User existiert? (Passwort resetten wir NICHT mehr bei jedem Start)
        // Nur wenn Admin gar nicht existiert, legen wir ihn an.
        const hash = await bcrypt.hash('memo', 10);
        await client.query(`
            INSERT INTO users (username, password_hash, full_name, rank)
            VALUES ($1, $2, $3, 'admin')
            ON CONFLICT (username) DO NOTHING
        `, ['admin', hash, 'System Administrator']);
        
        console.log('✅ Datenbank bereit & gesichert.');
    } catch (err) {
        console.error('❌ DB Fehler:', err);
    } finally {
        client.release();
    }
}

module.exports = { pool, initDB };