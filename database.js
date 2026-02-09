const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Verbindung zu Railway oder lokal
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Tabellen automatisch erstellen
async function initDB() {
    console.log('🔄 Prüfe Datenbank-Tabellen...');
    
    const client = await pool.connect();
    try {
        // Users Tabelle
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

        // Dokumente Tabelle
        await client.query(`
            CREATE TABLE IF NOT EXISTS documents (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT,
                created_by TEXT REFERENCES users(username),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Standard Admin erstellen (admin / memo)
        const hash = await bcrypt.hash('memo', 10);
        await client.query(`
            INSERT INTO users (username, password_hash, full_name, rank)
            VALUES ($1, $2, $3, 'admin')
            ON CONFLICT (username) DO NOTHING
        `, ['admin', hash, 'System Administrator']);
        
        console.log('✅ Datenbank bereit & Admin geprüft.');
    } catch (err) {
        console.error('❌ Datenbank-Fehler:', err);
    } finally {
        client.release();
    }
}

module.exports = { pool, initDB };