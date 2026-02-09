const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
    console.log('🔄 Prüfe Datenbank-Tabellen...');
    const client = await pool.connect();
    try {
        // Tabellen erstellen (User, Docs, Ranks)
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                rank TEXT DEFAULT 'besucher',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS documents (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT,
                created_by TEXT REFERENCES users(username),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS ranks (
                name TEXT PRIMARY KEY,
                color TEXT NOT NULL,
                permissions TEXT DEFAULT '[]'
            );
        `);

        // Standard-Ränge definieren
        const defaultRanks = [
            // Admin bekommt ALLE Rechte
            ['admin', '#e74c3c', JSON.stringify(['access_docs', 'manage_users', 'manage_ranks'])],
            ['nc-team', '#e67e22', JSON.stringify(['access_docs', 'manage_users'])],
            ['user', '#3498db', JSON.stringify(['access_docs'])],
            ['besucher', '#95a5a6', JSON.stringify([])]
        ];

        // HIER IST DER FIX: Wir nutzen DO UPDATE statt DO NOTHING
        for (const [name, color, perms] of defaultRanks) {
            await client.query(`
                INSERT INTO ranks (name, color, permissions) 
                VALUES ($1, $2, $3) 
                ON CONFLICT (name) 
                DO UPDATE SET permissions = $3, color = $2
            `, [name, color, perms]);
        }

        // Admin User sicherstellen
        const hash = await bcrypt.hash('memo', 10);
        await client.query(`
            INSERT INTO users (username, password_hash, full_name, rank)
            VALUES ($1, $2, $3, 'admin')
            ON CONFLICT (username) 
            DO UPDATE SET password_hash = $2
        `, ['admin', hash, 'System Administrator']);
        
        console.log('✅ Datenbank & Rechte aktualisiert.');
    } catch (err) {
        console.error('❌ Datenbank-Fehler:', err);
    } finally {
        client.release();
    }
}

module.exports = { pool, initDB };