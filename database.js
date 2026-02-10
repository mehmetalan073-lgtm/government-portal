const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
    console.log('🔄 Datenbank-Reparatur & Update...');
    const client = await pool.connect();
    try {
        // 1. Tabellen erstellen (falls sie fehlen)
        await client.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL, rank TEXT DEFAULT 'besucher', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);

        await client.query(`CREATE TABLE IF NOT EXISTS documents (
            id SERIAL PRIMARY KEY, title TEXT NOT NULL, content TEXT,
            created_by TEXT REFERENCES users(username), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);

        await client.query(`CREATE TABLE IF NOT EXISTS ranks (
            name TEXT PRIMARY KEY, color TEXT NOT NULL, permissions TEXT DEFAULT '[]'
        );`);

        // 2. FEHLENDE SPALTEN NACHTRÄGLICH HINZUFÜGEN (Das behebt deinen Fehler!)
        
        // Für das KICK-SYSTEM:
        await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until TIMESTAMP");
        await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP");
        await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS kick_message TEXT");
        await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS kicked_by TEXT");
        await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS force_logout BOOLEAN DEFAULT FALSE");

        // Für das LEVEL & DRAG-DROP SYSTEM:
        await client.query("ALTER TABLE ranks ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 99");

        // 3. Admin-Rechte sicherstellen
        const adminPerms = JSON.stringify(['access_docs', 'manage_users', 'manage_ranks', 'kick_users']);
        await client.query(`
            INSERT INTO ranks (name, color, permissions, level) VALUES ($1, $2, $3, 1)
            ON CONFLICT (name) DO UPDATE SET permissions = $3, level = 1
        `, ['admin', '#e74c3c', adminPerms]);

        // 4. Andere Ränge sicherstellen (mit Leveln für Sortierung)
        const otherRanks = [
            ['nc-team', '#e67e22', JSON.stringify(['access_docs', 'manage_users', 'kick_users']), 2],
            ['user', '#3498db', JSON.stringify(['access_docs']), 3],
            ['besucher', '#95a5a6', JSON.stringify([]), 99]
        ];
        
        for (const [name, color, perms, lvl] of otherRanks) {
            // Wir updaten hier NICHT das Level, damit deine eigene Sortierung nicht überschrieben wird!
            // Nur beim Erstellen wird ein Level gesetzt.
            await client.query(`
                INSERT INTO ranks (name, color, permissions, level) VALUES ($1, $2, $3, $4) 
                ON CONFLICT (name) DO NOTHING
            `, [name, color, perms, lvl]);
        }

        // 5. Admin User sicherstellen
        const hash = await bcrypt.hash('memo', 10);
        await client.query(`
            INSERT INTO users (username, password_hash, full_name, rank) VALUES ($1, $2, $3, 'admin')
            ON CONFLICT (username) DO NOTHING
        `, ['admin', hash, 'System Administrator']);
        
        console.log('✅ Datenbank erfolgreich repariert (Alle Spalten da).');
    } catch (err) {
        console.error('❌ DB Fehler:', err);
    } finally {
        client.release();
    }
}

module.exports = { pool, initDB };