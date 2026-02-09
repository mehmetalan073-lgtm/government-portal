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

        // NEU: Tabelle für Rang-Farben
        await client.query(`
            CREATE TABLE IF NOT EXISTS rank_colors (
                rank_name TEXT PRIMARY KEY,
                color_hex TEXT NOT NULL
            );
        `);

        // Standard-Farben setzen (falls noch keine da sind)
        const defaultColors = [
            ['admin', '#e74c3c'],      // Rot
            ['nc-team', '#e67e22'],    // Orange
            ['user', '#3498db'],       // Blau
            ['besucher', '#95a5a6']    // Grau
        ];

        for (const [rank, color] of defaultColors) {
            await client.query(`
                INSERT INTO rank_colors (rank_name, color_hex) 
                VALUES ($1, $2) 
                ON CONFLICT (rank_name) DO NOTHING
            `, [rank, color]);
        }

        // Admin User
        const hash = await bcrypt.hash('memo', 10);
        await client.query(`
            INSERT INTO users (username, password_hash, full_name, rank)
            VALUES ($1, $2, $3, 'admin')
            ON CONFLICT (username) DO NOTHING
        `, ['admin', hash, 'System Administrator']);
        
        console.log('✅ Datenbank bereit.');
    } catch (err) {
        console.error('❌ Datenbank-Fehler:', err);
    } finally {
        client.release();
    }
}

module.exports = { pool, initDB };