// server.js v23 - PostgreSQL Version - TEIL 1: Setup und Konfiguration
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');

// Multer-Konfiguration für DOCX-Upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'uploads/templates/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + '.docx');
    }
});

// PostgreSQL Pool-Konfiguration
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            cb(null, true);
        } else {
            cb(new Error('Nur DOCX-Dateien sind erlaubt'), false);
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB Limit
    }
});

// PostgreSQL-Verbindung testen
pool.connect()
    .then(client => {
        console.log('✅ PostgreSQL connected successfully');
        client.release();
    })
    .catch(err => {
        console.error('❌ PostgreSQL connection failed:', err);
        process.exit(1);
    });

// Imports für DOCX-Processing
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const mammoth = require('mammoth');

// Generierte Dateien Verzeichnis
const generatedDir = 'uploads/generated/';
if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? true 
        : 'http://localhost:3000'
}));
app.use(express.static('public'));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Log-Eintrag erstellen (Hilfsfunktion)
async function createLogEntry(action, performedBy, userRank, details, targetUser = null, ipAddress = null) {
    try {
        await pool.query(`
            INSERT INTO system_log (action, performed_by, user_rank, details, target_user, ip_address) 
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [action, performedBy, userRank, details, targetUser, ipAddress]);
    } catch (err) {
        console.error('Log Fehler:', err);
    }
}
// server.js v23 - PostgreSQL Version - TEIL 2: Datenbank-Initialisierung und Hilfsfunktionen

// ✅ PostgreSQL Initialisierung
async function initializeDatabase() {
    console.log('🔧 Initializing PostgreSQL tables...');
    
    try {
        // File counters table für B-Nummer
        await pool.query(`
            CREATE TABLE IF NOT EXISTS file_counters (
                id SERIAL PRIMARY KEY,
                prefix VARCHAR(10) UNIQUE NOT NULL,
                current_number INTEGER DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Initiale B-Counter erstellen
        await pool.query(`
            INSERT INTO file_counters (prefix, current_number)
            VALUES ('B', 0)
            ON CONFLICT (prefix) DO NOTHING
        `);
        
        // Users table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                full_name VARCHAR(255) NOT NULL,
                rank VARCHAR(50) DEFAULT 'user',
                role VARCHAR(50) DEFAULT 'user',
                status VARCHAR(50) DEFAULT 'approved',
                dark_mode INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                approved_by VARCHAR(255),
                approved_at TIMESTAMP
            )
        `);
        
        // Registrations table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS registrations (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                full_name VARCHAR(255) NOT NULL,
                reason TEXT NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                approved_by VARCHAR(255),
                approved_at TIMESTAMP
            )
        `);
        
        // Documents table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS documents (
                id SERIAL PRIMARY KEY,
                full_name VARCHAR(255) NOT NULL,
                birth_date VARCHAR(255),
                address TEXT,
                phone VARCHAR(255),
                purpose TEXT,
                application_date VARCHAR(255),
                additional_info TEXT,
                created_by VARCHAR(255) NOT NULL,
                template_response_id INTEGER,
                document_type VARCHAR(50) DEFAULT 'manual',
                generated_docx_path TEXT,
                generated_filename VARCHAR(255),
                file_number VARCHAR(255),
                preview_html TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Username change requests
        await pool.query(`
            CREATE TABLE IF NOT EXISTS username_change_requests (
                id SERIAL PRIMARY KEY,
                current_username VARCHAR(255) NOT NULL,
                new_username VARCHAR(255) NOT NULL,
                reason TEXT NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                approved_by VARCHAR(255),
                approved_at TIMESTAMP
            )
        `);
        
        // System log
        await pool.query(`
            CREATE TABLE IF NOT EXISTS system_log (
                id SERIAL PRIMARY KEY,
                action VARCHAR(255) NOT NULL,
                performed_by VARCHAR(255) NOT NULL,
                user_rank VARCHAR(50),
                details TEXT,
                target_user VARCHAR(255),
                ip_address VARCHAR(255),
                session_id VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // G-Docs templates
        await pool.query(`
            CREATE TABLE IF NOT EXISTS gdocs_templates (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                file_path TEXT NOT NULL,
                original_filename VARCHAR(255),
                available_ranks TEXT NOT NULL,
                questions TEXT,
                created_by VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Template responses
        await pool.query(`
            CREATE TABLE IF NOT EXISTS template_responses (
                id SERIAL PRIMARY KEY,
                template_id INTEGER NOT NULL,
                answers TEXT NOT NULL,
                submitted_by VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('✅ All PostgreSQL tables created');
        
        // Create admin user
        const adminPassword = bcrypt.hashSync('memo', 10);
        const adminResult = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
        
        if (adminResult.rows.length === 0) {
            await pool.query(`
                INSERT INTO users (username, password_hash, full_name, rank, role, status) 
                VALUES ($1, $2, $3, $4, $5, $6)
            `, ['admin', adminPassword, 'Systemadministrator', 'admin', 'admin', 'approved']);
            console.log('✅ Admin user created');
        }
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        process.exit(1);
    }
}

// Datenbank initialisieren
initializeDatabase();

// Vereinfachte Funktion: Nächste B-Nummer generieren
async function getNextFileNumber() {
    try {
        console.log('📊 Generiere nächste B-Nummer (Bewertung)...');
        
        // Hole aktuellen B-Counter und erhöhe um 1
        const result = await pool.query('SELECT current_number FROM file_counters WHERE prefix = $1', ['B']);
        
        const currentNumber = result.rows.length > 0 ? result.rows[0].current_number : 0;
        const nextNumber = currentNumber + 1;
        
        // Update Counter in Datenbank
        await pool.query('UPDATE file_counters SET current_number = $1, updated_at = CURRENT_TIMESTAMP WHERE prefix = $2', 
                         [nextNumber, 'B']);
        
        // Formatiere Nummer mit führenden Nullen (4-stellig)
        const formattedNumber = nextNumber.toString().padStart(4, '0');
        const fileNumber = `#B${formattedNumber}-SOCOM`;
        
        console.log(`✅ Neue B-Nummer generiert: ${fileNumber}`);
        return fileNumber;
        
    } catch (error) {
        console.error('❌ Fehler beim Generieren der B-Nummer:', error);
        throw error;
    }
}

async function generateDocxFromTemplate(templatePath, answers, outputFilename, submittedBy, templateName = '') {
    try {
        console.log('📄 Generiere DOCX aus Template:', templatePath);
        console.log('📝 Antworten:', answers);
        console.log('👤 Erstellt von:', submittedBy);
        
        // Template-Datei lesen
        const templateContent = fs.readFileSync(templatePath, 'binary');
        const zip = new PizZip(templateContent);
        
        // Docxtemplater erstellen
        const doc = new Docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
        });
        
        // Erstelle Template-Daten Object
        const templateData = {};
        
        // Konvertiere field-X zu readable names falls möglich
        Object.entries(answers).forEach(([key, value]) => {
            const cleanKey = key.replace('field-', '');
            templateData[cleanKey] = Array.isArray(value) ? value.join(', ') : value;
            templateData[key] = Array.isArray(value) ? value.join(', ') : value;
        });
        
        // Lade Benutzerdaten aus der Datenbank
        const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [submittedBy]);
        const userData = userResult.rows.length > 0 ? userResult.rows[0] : {};
        
        console.log('👤 Benutzerdaten geladen:', userData.full_name);
        
        // ✅ GENERIERE AUTOMATISCHE B-FILE-NUMMER
        const fileNumber = await getNextFileNumber();
        console.log('🔢 Automatische B-Nummer:', fileNumber);
        
        // AUTOMATISCHE TEMPLATE-DATEN hinzufügen
        const now = new Date();
        
        // ✅ FILE-NUMMER (immer B-Format)
        templateData.fileNumber = fileNumber;
        templateData.fileNumberWithoutHash = fileNumber.replace('#', '');
        templateData.fileNumberOnly = fileNumber.match(/\d+/)?.[0] || '0001';
        templateData.filePrefix = 'B'; // Immer B für Bewertung
        templateData.fileSuffix = 'SOCOM'; // Immer SOCOM
        
        // ✅ DATUM & ZEIT
        templateData.generatedDate = now.toLocaleDateString('de-DE');
        templateData.generatedTime = now.toLocaleTimeString('de-DE');
        templateData.generatedDateTime = now.toLocaleString('de-DE');
        templateData.currentYear = now.getFullYear().toString();
        templateData.currentMonth = (now.getMonth() + 1).toString().padStart(2, '0');
        templateData.currentDay = now.getDate().toString().padStart(2, '0');
        
        // ✅ BENUTZER-DATEN (automatisch)
        templateData.currentUser = submittedBy;
        templateData.currentUserName = userData.full_name || submittedBy;
        templateData.currentUserEmail = userData.email || '';
        templateData.currentUserRank = userData.rank || 'user';
        templateData.currentUserRankDisplay = getRankDisplay(userData.rank || 'user');
        
        // ✅ SYSTEM-DATEN
        templateData.systemName = 'Regierungspanel';
        templateData.templateName = templateName;
        
        // ✅ DEUTSCHE FORMATIERUNG
        templateData.generatedDateLong = now.toLocaleDateString('de-DE', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        
        console.log('🔄 Template-Daten (mit B-Nummer):', {
            fileNumber: templateData.fileNumber,
            currentUserName: templateData.currentUserName,
            generatedDate: templateData.generatedDate
        });
        
        // Template rendern
        doc.render(templateData);
        
        // Ausgabe-Datei generieren
        const outputPath = path.join(generatedDir, outputFilename);
        const generatedBuffer = doc.getZip().generate({
            type: 'nodebuffer',
            compression: 'DEFLATE',
        });
        
        fs.writeFileSync(outputPath, generatedBuffer);
        console.log('✅ DOCX generiert:', outputPath);
        
        // Gib auch die File-Nummer zurück für weitere Verwendung
        return { 
            path: outputPath, 
            fileNumber: fileNumber 
        };
        
    } catch (error) {
        console.error('❌ DOCX Generation Fehler:', error);
        throw error;
    }
}

// Hilfsfunktion für Rang-Anzeige
function getRankDisplay(rank) {
    const rankDisplays = {
        'nc-team': 'NC-TEAM',
        'president': 'PRESIDENT', 
        'vice-president': 'VICE PRESIDENT',
        'admin': 'ADMIN',
        'kabinettsmitglied': 'KABINETT',
        'socom-operator': 'SOCOM',
        'user': 'USER',
        'besucher': 'BESUCHER'
    };
    return rankDisplays[rank] || 'USER';
}

// Funktion: DOCX zu HTML für Vorschau konvertieren
async function convertDocxToHtml(docxPath) {
    try {
        console.log('🔄 Konvertiere DOCX zu HTML:', docxPath);
        
        const result = await mammoth.convertToHtml({
            path: docxPath
        });
        
        const html = result.value;
        const messages = result.messages;
        
        if (messages.length > 0) {
            console.log('⚠️ Mammoth Warnungen:', messages);
        }
        
        console.log('✅ DOCX zu HTML konvertiert');
        return html;
        
    } catch (error) {
        console.error('❌ DOCX zu HTML Fehler:', error);
        throw error;
    }
}

// Funktion: Eindeutigen Dateinamen generieren
function generateUniqueFilename(templateName, submittedBy) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedTemplateName = templateName.replace(/[^a-zA-Z0-9]/g, '_');
    const sanitizedUsername = submittedBy.replace(/[^a-zA-Z0-9]/g, '_');
    
    return `${sanitizedTemplateName}_${sanitizedUsername}_${timestamp}.docx`;
}
// server.js v23 - PostgreSQL Version - TEIL 3: Authentifizierung und Benutzerverwaltung APIs

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1 AND status = $2', [username, 'approved']);
        
        if (result.rows.length === 0 || !bcrypt.compareSync(password, result.rows[0].password_hash)) {
            return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
        }
        
        const user = result.rows[0];
        
        // Log-Eintrag für Login
        createLogEntry('LOGIN', username, user.rank || 'user', `Benutzer angemeldet`, null, req.ip);
        
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                fullName: user.full_name,
                rank: user.rank || 'user',
                role: user.role,
                darkMode: user.dark_mode === 1
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Registrierung beantragen
app.post('/api/register', async (req, res) => {
    const { username, password, fullName, reason } = req.body;
    
    if (!username || !password || !fullName || !reason) {
        return res.status(400).json({ error: 'Alle Felder sind erforderlich' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });
    }
    
    const passwordHash = bcrypt.hashSync(password, 10);
    
    try {
        const result = await pool.query(`INSERT INTO registrations (username, password_hash, full_name, reason) 
            VALUES ($1, $2, $3, $4) RETURNING id`, 
            [username, passwordHash, fullName, reason]);
        
        res.json({ success: true, registrationId: result.rows[0].id });
    } catch (err) {
        if (err.message.includes('duplicate key') || err.message.includes('unique')) {
            return res.status(400).json({ error: 'Benutzername bereits vergeben' });
        }
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Wartende Registrierungen abrufen
app.get('/api/pending-registrations', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM registrations WHERE status = $1 ORDER BY created_at DESC', ['pending']);
        res.json(result.rows || []);
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Registrierung genehmigen
app.post('/api/approve-registration/:id', async (req, res) => {
    const { id } = req.params;
    const { adminUsername } = req.body;
    
    try {
        const registrationResult = await pool.query('SELECT * FROM registrations WHERE id = $1', [id]);
        
        if (registrationResult.rows.length === 0) {
            return res.status(404).json({ error: 'Registrierung nicht gefunden' });
        }
        
        const registration = registrationResult.rows[0];
        
        // Benutzer mit Standard-Rang 'besucher' erstellen
        await pool.query(`INSERT INTO users (username, password_hash, full_name, rank, role, status, approved_by, approved_at) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
            [registration.username, registration.password_hash, registration.full_name, 'besucher', 'user', 'approved', adminUsername]);
        
        await pool.query(`UPDATE registrations SET status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP WHERE id = $3`,
                         ['approved', adminUsername, id]);
        
        // Log-Eintrag für Genehmigung
        createLogEntry('USER_APPROVED', adminUsername, 'admin', `Benutzer ${registration.username} genehmigt`, registration.username, req.ip);
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Registrierung ablehnen
app.post('/api/reject-registration/:id', async (req, res) => {
    const { id } = req.params;
    const { adminUsername } = req.body;
    
    try {
        const registrationResult = await pool.query('SELECT * FROM registrations WHERE id = $1', [id]);
        
        if (registrationResult.rows.length === 0) {
            return res.status(404).json({ error: 'Registrierung nicht gefunden' });
        }
        
        const registration = registrationResult.rows[0];
        
        await pool.query(`UPDATE registrations SET status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP WHERE id = $3`,
                         ['rejected', adminUsername, id]);
        
        // Log-Eintrag für Ablehnung
        createLogEntry('USER_REJECTED', adminUsername, 'admin', `Registrierungsantrag von ${registration.username} abgelehnt`, registration.username, req.ip);
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Alle Benutzer abrufen
app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, full_name, rank, role, status, created_at, approved_by, approved_at FROM users ORDER BY created_at DESC');
        res.json(result.rows || []);
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Rang ändern
app.post('/api/update-rank/:id', async (req, res) => {
    const { id } = req.params;
    const { rank, adminUsername } = req.body;
    
    // Prüfen ob Rang gültig ist
    const validRanks = ['nc-team', 'president', 'vice-president', 'admin', 'kabinettsmitglied', 
                        'socom-operator', 'user', 'besucher'];
    
    if (!validRanks.includes(rank)) {
        return res.status(400).json({ error: 'Ungültiger Rang' });
    }
    
    try {
        // Admin kann nicht degradiert werden
        const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [id]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }
        
        const user = userResult.rows[0];
        
        if (user.username === 'admin' && rank !== 'admin') {
            return res.status(403).json({ error: 'Admin-Rang kann nicht geändert werden' });
        }
        
        await pool.query('UPDATE users SET rank = $1 WHERE id = $2', [rank, id]);
        
        // Log-Eintrag für Rang-Änderung
        createLogEntry('USER_RANK_UPDATED', adminUsername, 'admin', `Rang geändert zu ${rank}`, user.username, req.ip);
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Benutzer löschen
app.delete('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [id]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }
        
        const user = userResult.rows[0];
        
        if (user.username === 'admin') {
            return res.status(403).json({ error: 'Admin kann nicht gelöscht werden' });
        }
        
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        
        // Log-Eintrag für Löschung
        createLogEntry('USER_DELETED', 'admin', 'admin', `Benutzer ${user.username} entfernt`, user.username, req.ip);
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Dark Mode Update
app.post('/api/update-dark-mode', async (req, res) => {
    const { username, darkMode } = req.body;
    
    try {
        await pool.query('UPDATE users SET dark_mode = $1 WHERE username = $2', 
                         [darkMode ? 1 : 0, username]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Dark Mode Status abrufen
app.get('/api/dark-mode/:username', async (req, res) => {
    const { username } = req.params;
    
    try {
        const result = await pool.query('SELECT dark_mode FROM users WHERE username = $1', [username]);
        res.json({ darkMode: result.rows.length > 0 ? result.rows[0].dark_mode === 1 : false });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Username Change Request einreichen
app.post('/api/request-username-change', async (req, res) => {
    const { currentUsername, newUsername, reason } = req.body;
    
    if (!currentUsername || !newUsername || !reason) {
        return res.status(400).json({ error: 'Alle Felder sind erforderlich' });
    }
    
    if (newUsername.length < 3 || newUsername.length > 20) {
        return res.status(400).json({ error: 'Benutzername muss zwischen 3 und 20 Zeichen haben' });
    }
    
    try {
        // Prüfen ob neuer Username bereits existiert
        const existingResult = await pool.query('SELECT username FROM users WHERE username = $1', [newUsername]);
        
        if (existingResult.rows.length > 0) {
            return res.status(400).json({ error: 'Gewünschter Benutzername ist bereits vergeben' });
        }
        
        const result = await pool.query(`INSERT INTO username_change_requests (current_username, new_username, reason) 
                VALUES ($1, $2, $3) RETURNING id`, 
                [currentUsername, newUsername, reason]);
        
        res.json({ success: true, requestId: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Username Change Requests abrufen
app.get('/api/username-change-requests', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM username_change_requests WHERE status = $1 ORDER BY created_at DESC', ['pending']);
        res.json(result.rows || []);
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Username Change genehmigen
app.post('/api/approve-username-change/:id', async (req, res) => {
    const { id } = req.params;
    const { adminUsername } = req.body;
    
    try {
        const requestResult = await pool.query('SELECT * FROM username_change_requests WHERE id = $1', [id]);
        
        if (requestResult.rows.length === 0) {
            return res.status(404).json({ error: 'Antrag nicht gefunden' });
        }
        
        const request = requestResult.rows[0];
        
        // Prüfen ob neuer Username immer noch verfügbar ist
        const existingResult = await pool.query('SELECT username FROM users WHERE username = $1', [request.new_username]);
        
        if (existingResult.rows.length > 0) {
            return res.status(400).json({ error: 'Gewünschter Benutzername ist inzwischen vergeben' });
        }
        
        // Username in users Tabelle ändern
        await pool.query('UPDATE users SET username = $1 WHERE username = $2', 
                         [request.new_username, request.current_username]);
        
        // Request als genehmigt markieren
        await pool.query(`UPDATE username_change_requests SET status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP WHERE id = $3`,
                         ['approved', adminUsername, id]);
        
        // Log-Eintrag für Username-Änderung
        createLogEntry('USERNAME_CHANGED', adminUsername, 'admin', `Username von ${request.current_username} zu ${request.new_username} geändert`, request.new_username, req.ip);
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Username Change ablehnen
app.post('/api/reject-username-change/:id', async (req, res) => {
    const { id } = req.params;
    const { adminUsername } = req.body;
    
    try {
        const requestResult = await pool.query('SELECT * FROM username_change_requests WHERE id = $1', [id]);
        
        if (requestResult.rows.length === 0) {
            return res.status(404).json({ error: 'Antrag nicht gefunden' });
        }
        
        const request = requestResult.rows[0];
        
        await pool.query(`UPDATE username_change_requests SET status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP WHERE id = $3`,
                         ['rejected', adminUsername, id]);
        
        // Log-Eintrag für Ablehnung
        createLogEntry('USERNAME_CHANGE_REJECTED', adminUsername, 'admin', `Username-Änderungsantrag von ${request.current_username} abgelehnt`, request.current_username, req.ip);
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// System Log abrufen (nur für Admin)
app.get('/api/system-log', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM system_log ORDER BY created_at DESC LIMIT 100');
        res.json(result.rows || []);
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});
// server.js v23 - PostgreSQL Version - TEIL 4: Dokumente und Templates APIs

// ✅ Dokument erstellen
app.post('/api/create-document', async (req, res) => {
    console.log('📝 /api/create-document aufgerufen');
    console.log('📋 Request Body:', req.body);
    
    const { fullName, birthDate, address, phone, purpose, 
        applicationDate, additional, createdBy } = req.body;
    
    if (!fullName || !purpose || !createdBy) {
        console.error('❌ Validierung fehlgeschlagen:', { fullName, purpose, createdBy });
        return res.status(400).json({ error: 'Name, Zweck und Ersteller sind erforderlich' });
    }
    
    console.log('✅ Validierung erfolgreich, füge in Datenbank ein...');
    
    try {
        const result = await pool.query(`INSERT INTO documents (full_name, birth_date, address, phone, 
            purpose, application_date, additional_info, created_by, document_type) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [fullName, birthDate, address, phone, purpose, 
             applicationDate, additional, createdBy, 'manual']);
        
        console.log('✅ Dokument erfolgreich erstellt mit ID:', result.rows[0].id);
        
        // Erstelle Log-Eintrag
        createLogEntry('DOCUMENT_CREATED', createdBy, 'user', `Dokument "${purpose}" erstellt`, null, req.ip);
        
        res.json({ success: true, documentId: result.rows[0].id });
    } catch (err) {
        console.error('❌ Datenbank-Fehler beim Erstellen des Dokuments:', err);
        res.status(500).json({ error: 'Fehler beim Speichern: ' + err.message });
    }
});

// Dokumente eines Benutzers abrufen
app.get('/api/documents/:username', async (req, res) => {
    const { username } = req.params;
    const { filterType, templateId } = req.query;
    
    console.log('📄 /api/documents/:username aufgerufen für:', username);
    console.log('🔍 Filter:', { filterType, templateId });
    
    let query = `
        SELECT 
            d.*,
            gt.name as template_name,
            gt.description as template_description
        FROM documents d
        LEFT JOIN template_responses tr ON d.template_response_id = tr.id
        LEFT JOIN gdocs_templates gt ON tr.template_id = gt.id
        WHERE d.created_by = $1
    `;
    let queryParams = [username];
    let paramIndex = 2;
    
    // Filter basierend auf Typ anwenden
    if (filterType === 'manual') {
        query += ` AND d.document_type = $${paramIndex}`;
        queryParams.push('manual');
        paramIndex++;
        console.log('🔍 Filter: Nur manuelle Dokumente');
    } else if (filterType === 'template' && templateId) {
        query += ` AND tr.template_id = $${paramIndex}`;
        queryParams.push(templateId);
        paramIndex++;
        console.log('🔍 Filter: Nur Template ID', templateId);
    } else if (filterType === 'template') {
        query += ` AND d.document_type = $${paramIndex}`;
        queryParams.push('template');
        paramIndex++;
        console.log('🔍 Filter: Alle Fragebogen-Dokumente');
    }
    
    query += ` ORDER BY d.created_at DESC`;
    
    console.log('📋 SQL Query:', query);
    console.log('📋 Query Params:', queryParams);
    
    try {
        const result = await pool.query(query, queryParams);
        
        console.log('📊 Dokumente gefunden für', username + ':', result.rows.length);
        if (result.rows.length > 0) {
            console.log('📋 Erste 3 Dokumente:', result.rows.slice(0, 3).map(doc => ({
                id: doc.id,
                full_name: doc.full_name,
                document_type: doc.document_type,
                template_name: doc.template_name
            })));
        }
        
        res.json(result.rows || []);
    } catch (err) {
        console.error('❌ Datenbank-Fehler beim Laden der Dokumente:', err);
        res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
    }
});

// Alle Dokumente abrufen (neue Route)
app.get('/api/all-documents', async (req, res) => {
    const { filterType, templateId } = req.query;
    
    console.log('📄 /api/all-documents aufgerufen - Lade alle Dokumente');
    console.log('🔍 Filter:', { filterType, templateId });
    
    let query = `
        SELECT 
            d.*,
            u.full_name as creator_full_name,
            u.rank as creator_rank,
            gt.name as template_name,
            gt.description as template_description
        FROM documents d
        LEFT JOIN users u ON d.created_by = u.username
        LEFT JOIN template_responses tr ON d.template_response_id = tr.id
        LEFT JOIN gdocs_templates gt ON tr.template_id = gt.id
    `;
    let queryParams = [];
    let paramIndex = 1;
    
    // Filter basierend auf Typ anwenden
    if (filterType === 'manual') {
        query += ` WHERE d.document_type = $${paramIndex}`;
        queryParams.push('manual');
        paramIndex++;
        console.log('🔍 Filter: Nur manuelle Dokumente');
    } else if (filterType === 'template' && templateId) {
        query += ` WHERE tr.template_id = $${paramIndex}`;
        queryParams.push(templateId);
        paramIndex++;
        console.log('🔍 Filter: Nur Template ID', templateId);
    } else if (filterType === 'template') {
        query += ` WHERE d.document_type = $${paramIndex}`;
        queryParams.push('template');
        paramIndex++;
        console.log('🔍 Filter: Alle Fragebogen-Dokumente');
    }
    
    query += ` ORDER BY d.created_at DESC`;
    
    console.log('📋 SQL Query:', query);
    console.log('📋 Query Params:', queryParams);
    
    try {
        const result = await pool.query(query, queryParams);
        
        console.log('📊 Alle Dokumente geladen:', result.rows.length);
        if (result.rows.length > 0) {
            console.log('📋 Erste 3 Dokumente:', result.rows.slice(0, 3).map(doc => ({
                id: doc.id,
                full_name: doc.full_name,
                created_by: doc.created_by,
                document_type: doc.document_type,
                template_name: doc.template_name
            })));
        }
        
        res.json(result.rows || []);
    } catch (err) {
        console.error('❌ Datenbank-Fehler beim Laden aller Dokumente:', err);
        res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
    }
});

// Dokument aktualisieren
app.put('/api/documents/:id', async (req, res) => {
    const { id } = req.params;
    const { fullName, birthDate, address, phone, purpose, applicationDate, additional } = req.body;
    
    console.log('✏️ /api/documents/:id PUT aufgerufen für ID:', id);
    console.log('📝 Update-Daten:', { fullName, purpose });
    
    if (!id || isNaN(id)) {
        console.error('❌ Ungültige Dokument-ID:', id);
        return res.status(400).json({ error: 'Ungültige Dokument-ID' });
    }
    
    // Validierung
    if (!fullName || !purpose) {
        console.error('❌ Validierung fehlgeschlagen');
        return res.status(400).json({ error: 'Name und Zweck sind erforderlich' });
    }
    
    try {
        // Prüfe ob Dokument existiert
        const documentResult = await pool.query('SELECT * FROM documents WHERE id = $1', [id]);
        
        if (documentResult.rows.length === 0) {
            console.error('❌ Dokument nicht gefunden mit ID:', id);
            return res.status(404).json({ error: 'Dokument nicht gefunden' });
        }
        
        const document = documentResult.rows[0];
        console.log('📄 Zu aktualisierendes Dokument gefunden:', document.purpose);
        
        // Update ausführen
        const updateResult = await pool.query(`UPDATE documents SET 
                full_name = $1, birth_date = $2, address = $3, phone = $4, 
                purpose = $5, application_date = $6, additional_info = $7
                WHERE id = $8`,
                [fullName, birthDate, address, phone, purpose, applicationDate, additional, id]);
        
        if (updateResult.rowCount === 0) {
            console.error('❌ Kein Dokument wurde aktualisiert');
            return res.status(404).json({ error: 'Dokument konnte nicht aktualisiert werden' });
        }
        
        console.log('✅ Dokument erfolgreich aktualisiert, ID:', id, 'Rows affected:', updateResult.rowCount);
        
        // Log-Eintrag erstellen
        createLogEntry('DOCUMENT_UPDATED', document.created_by, 'user', `Dokument "${purpose}" aktualisiert (ID: ${id})`, null, req.ip);
        
        res.json({ success: true, message: 'Dokument erfolgreich aktualisiert' });
    } catch (err) {
        console.error('❌ Fehler beim Update:', err);
        res.status(500).json({ error: 'Fehler beim Aktualisieren: ' + err.message });
    }
});

// Dokument löschen
app.delete('/api/documents/:id', async (req, res) => {
    const { id } = req.params;
    console.log('🗑️ /api/documents/:id DELETE aufgerufen für ID:', id);
    
    if (!id || isNaN(id)) {
        console.error('❌ Ungültige Dokument-ID:', id);
        return res.status(400).json({ error: 'Ungültige Dokument-ID' });
    }
    
    try {
        // Prüfe ob Dokument existiert
        const documentResult = await pool.query('SELECT * FROM documents WHERE id = $1', [id]);
        
        if (documentResult.rows.length === 0) {
            console.error('❌ Dokument nicht gefunden mit ID:', id);
            return res.status(404).json({ error: 'Dokument nicht gefunden' });
        }
        
        const document = documentResult.rows[0];
        console.log('📄 Zu löschendes Dokument gefunden:', document);
        
        // Lösche das Dokument
        const deleteResult = await pool.query('DELETE FROM documents WHERE id = $1', [id]);
        
        if (deleteResult.rowCount === 0) {
            console.error('❌ Kein Dokument wurde gelöscht');
            return res.status(404).json({ error: 'Dokument konnte nicht gelöscht werden' });
        }
        
        console.log('✅ Dokument erfolgreich gelöscht, ID:', id, 'Rows affected:', deleteResult.rowCount);
        
        // Log-Eintrag erstellen
        createLogEntry('DOCUMENT_DELETED', document.created_by, 'user', `Dokument "${document.purpose}" gelöscht (ID: ${id})`, null, req.ip);
        
        res.json({ success: true, message: 'Dokument erfolgreich gelöscht' });
    } catch (err) {
        console.error('❌ Fehler beim Löschen des Dokuments:', err);
        res.status(500).json({ error: 'Fehler beim Löschen: ' + err.message });
    }
});

// Dokument-Details abrufen
app.get('/api/document/:id', async (req, res) => {
    const { id } = req.params;
    console.log('📄 /api/document/:id aufgerufen für ID:', id);
    
    if (!id || isNaN(id)) {
        console.error('❌ Ungültige Dokument-ID:', id);
        return res.status(400).json({ error: 'Ungültige Dokument-ID' });
    }
    
    const query = `
        SELECT 
            d.*,
            u.full_name as creator_full_name,
            u.rank as creator_rank,
            u.email as creator_email,
            tr.answers as template_answers,
            gt.name as template_name,
            gt.description as template_description
        FROM documents d
        LEFT JOIN users u ON d.created_by = u.username
        LEFT JOIN template_responses tr ON d.template_response_id = tr.id
        LEFT JOIN gdocs_templates gt ON tr.template_id = gt.id
        WHERE d.id = $1
    `;
    
    try {
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            console.error('❌ Dokument nicht gefunden mit ID:', id);
            return res.status(404).json({ error: 'Dokument nicht gefunden' });
        }
        
        const document = result.rows[0];
        console.log('📄 Dokument-Details geladen:', {
            id: document.id,
            full_name: document.full_name,
            created_by: document.created_by,
            document_type: document.document_type
        });
        
        res.json(document);
    } catch (err) {
        console.error('❌ Datenbank-Fehler beim Laden des Dokuments:', err);
        res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
    }
});

// G-Docs Template erstellen
app.post('/api/create-gdocs-template', upload.single('templateFile'), async (req, res) => {
    console.log('📁 Template-Upload gestartet');
    console.log('📁 Datei:', req.file);
    console.log('📋 Formulardaten:', req.body);
    
    if (!req.file) {
        return res.status(400).json({ error: 'Keine DOCX-Datei hochgeladen' });
    }
    
    const { name, description, createdBy } = req.body;
    let { availableRanks, questions } = req.body;
    
    if (!name || !createdBy) {
        return res.status(400).json({ error: 'Name und Ersteller sind erforderlich' });
    }
    
    // availableRanks kann als Array oder einzelne Werte kommen
    if (typeof availableRanks === 'string') {
        availableRanks = [availableRanks];
    }
    const ranksString = Array.isArray(availableRanks) ? availableRanks.join(',') : availableRanks;
    
    // questions als JSON parsen falls als String übertragen
    let questionsString = null;
    if (questions) {
        try {
            const questionsObj = typeof questions === 'string' ? JSON.parse(questions) : questions;
            questionsString = JSON.stringify(questionsObj);
        } catch (e) {
            questionsString = null;
        }
    }
    
    try {
        const result = await pool.query(`INSERT INTO gdocs_templates (name, description, file_path, original_filename, available_ranks, questions, created_by) 
                VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [name, description, req.file.path, req.file.originalname, ranksString, questionsString, createdBy]);
        
        console.log('✅ Template erfolgreich hochgeladen:', req.file.originalname);
        
        // Log-Eintrag
        const questionsCount = questionsString ? JSON.parse(questionsString).length : 0;
        createLogEntry('TEMPLATE_CREATED', createdBy, 'admin', `DOCX-Vorlage "${name}" mit ${questionsCount} Fragen hochgeladen`, null, req.ip);
        
        res.json({ success: true, templateId: result.rows[0].id });
    } catch (err) {
        console.error('Template-Upload Fehler:', err);
        res.status(500).json({ error: 'Fehler beim Speichern der Vorlage' });
    }
});

// Template bearbeiten
app.put('/api/update-gdocs-template/:id', upload.single('templateFile'), async (req, res) => {
    const { id } = req.params;
    const { name, description, availableRanks } = req.body;
    
    if (!name) {
        return res.status(400).json({ error: 'Name ist erforderlich' });
    }
    
    let updateQuery = 'UPDATE gdocs_templates SET name = $1, description = $2, available_ranks = $3';
    let params = [name, description, availableRanks];
    let paramIndex = 4;
    
    // Falls neue Datei hochgeladen
    if (req.file) {
        updateQuery += `, file_path = $${paramIndex}, original_filename = $${paramIndex + 1}`;
        params.push(req.file.path, req.file.originalname);
        paramIndex += 2;
    }
    
    updateQuery += ` WHERE id = $${paramIndex}`;
    params.push(id);
    
    try {
        await pool.query(updateQuery, params);
        
        createLogEntry('TEMPLATE_UPDATED', 'admin', 'admin', `Template "${name}" aktualisiert`, null, req.ip);
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Aktualisieren: ' + err.message });
    }
});

// Template-Fragen separat bearbeiten
app.put('/api/update-template-questions/:id', async (req, res) => {
    const { id } = req.params;
    const { questions } = req.body;
    
    if (!questions || !Array.isArray(questions)) {
        return res.status(400).json({ error: 'Fragen-Array ist erforderlich' });
    }
    
    if (questions.length === 0) {
        return res.status(400).json({ error: 'Mindestens eine Frage ist erforderlich' });
    }
    
    const questionsString = JSON.stringify(questions);
    
    try {
        // Prüfe ob Template existiert
        const templateResult = await pool.query('SELECT name, created_by FROM gdocs_templates WHERE id = $1', [id]);
        
        if (templateResult.rows.length === 0) {
            return res.status(404).json({ error: 'Template nicht gefunden' });
        }
        
        const template = templateResult.rows[0];
        
        // Aktualisiere nur die Fragen
        await pool.query('UPDATE gdocs_templates SET questions = $1 WHERE id = $2', [questionsString, id]);
        
        console.log(`✅ Fragen für Template "${template.name}" aktualisiert (${questions.length} Fragen)`);
        
        createLogEntry('TEMPLATE_QUESTIONS_UPDATED', template.created_by, 'admin', `${questions.length} Fragen für Template "${template.name}" aktualisiert`, null, req.ip);
        
        res.json({ 
            success: true, 
            message: `${questions.length} Fragen erfolgreich aktualisiert`,
            questionsCount: questions.length
        });
    } catch (err) {
        res.status(500).json({ error: 'Fehler beim Aktualisieren der Fragen: ' + err.message });
    }
});
// server.js v23 - PostgreSQL Version - TEIL 5: Template-Antworten, Downloads und Server-Start

// ✅ Template-Antwort einreichen
app.post('/api/submit-template-response', async (req, res) => {
    const { templateId, answers, submittedBy } = req.body;
    
    if (!templateId || !answers || !submittedBy) {
        return res.status(400).json({ error: 'Template ID, Antworten und Absender sind erforderlich' });
    }
    
    const answersString = JSON.stringify(answers);
    
    console.log('📋 Template-Antwort wird gespeichert:', { templateId, submittedBy });
    console.log('📝 Antworten:', answers);
    
    try {
        // 1. Hole Template-Informationen
        const templateResult = await pool.query('SELECT * FROM gdocs_templates WHERE id = $1', [templateId]);
        
        if (templateResult.rows.length === 0) {
            return res.status(404).json({ error: 'Template nicht gefunden' });
        }
        
        const template = templateResult.rows[0];
        console.log('📄 Template gefunden:', template.name);
        
        // 2. Template-Antwort in DB speichern
        const responseResult = await pool.query(`INSERT INTO template_responses (template_id, answers, submitted_by) 
                VALUES ($1, $2, $3) RETURNING id`,
                [templateId, answersString, submittedBy]);
        
        const responseId = responseResult.rows[0].id;
        console.log('✅ Template-Antwort gespeichert mit ID:', responseId);
        
        // 3. DOCX-Datei generieren (falls Template-Datei vorhanden)
        let generatedDocxPath = null;
        let generatedFilename = null;
        let generatedFileNumber = null;
        
        if (template.file_path && fs.existsSync(template.file_path)) {
            try {
                generatedFilename = generateUniqueFilename(template.name, submittedBy);
                console.log('📝 Generiere DOCX-Datei:', generatedFilename);
                
                const result = await generateDocxFromTemplate(
                    template.file_path, 
                    answers, 
                    generatedFilename,
                    submittedBy,
                    template.name
                );
                
                generatedDocxPath = result.path;
                generatedFileNumber = result.fileNumber;
                
                console.log('✅ DOCX-Datei generiert:', generatedDocxPath);
                console.log('🔢 File-Nummer:', generatedFileNumber);
                
            } catch (docxError) {
                console.error('⚠️ DOCX-Generation fehlgeschlagen:', docxError);
                // Weitermachen ohne DOCX
            }
        } else {
            console.log('⚠️ Template-Datei nicht gefunden:', template.file_path);
        }
        
        // 4. Dokument-Eintrag erstellen
        let fullName = 'Unbekannt';
        let phone = '';
        let address = '';
        let birthDate = '';
        let additionalInfo = '';
        
        // Extrahiere relevante Daten aus den Antworten
        for (const [fieldId, value] of Object.entries(answers)) {
            const lowerFieldId = fieldId.toLowerCase();
            
            if (lowerFieldId.includes('name') || fieldId === 'field-1') {
                fullName = value;
            } else if (lowerFieldId.includes('phone') || lowerFieldId.includes('tel')) {
                phone = value;
            } else if (lowerFieldId.includes('address') || lowerFieldId.includes('adresse')) {
                address = value;
            } else if (lowerFieldId.includes('birth') || lowerFieldId.includes('geburt')) {
                birthDate = value;
            } else {
                additionalInfo += `${fieldId}: ${value}\n`;
            }
        }
        
        console.log('📊 Extrahierte Daten:', { fullName, phone, address, birthDate });
        
        // 5. Dokument in DB erstellen
        const purpose = `Fragebogen: ${template.name}`;
        const applicationDate = new Date().toISOString().split('T')[0];
        
        const documentResult = await pool.query(`INSERT INTO documents (full_name, birth_date, address, phone, 
            purpose, application_date, additional_info, created_by, template_response_id, 
            document_type, generated_docx_path, generated_filename, file_number) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
            [fullName, birthDate, address, phone, purpose, 
             applicationDate, additionalInfo.trim(), submittedBy, responseId, 'template',
             generatedDocxPath, generatedFilename, generatedFileNumber]);
        
        const documentId = documentResult.rows[0].id;
        console.log('✅ Dokument erstellt mit ID:', documentId);
        
        // 6. Log-Einträge
        createLogEntry('TEMPLATE_RESPONSE_SUBMITTED', submittedBy, 'user', `Fragebogen "${template.name}" ausgefüllt`, null, req.ip);
        createLogEntry('DOCUMENT_CREATED', submittedBy, 'user', `Dokument aus Fragebogen "${template.name}" erstellt`, null, req.ip);
        
        if (generatedDocxPath) {
            createLogEntry('DOCX_GENERATED', submittedBy, 'user', `DOCX-Datei "${generatedFilename}" generiert`, null, req.ip);
        }
        
        // 7. Erfolgreiche Antwort
        res.json({ 
            success: true, 
            responseId: responseId,
            documentId: documentId,
            generatedFile: generatedFilename,
            fileNumber: generatedFileNumber,
            hasGeneratedDocx: !!generatedDocxPath,
            message: generatedDocxPath 
                ? `Fragebogen erfolgreich ausgefüllt! DOCX-Datei "${generatedFileNumber}" wurde generiert und ist zum Download verfügbar.` 
                : 'Fragebogen erfolgreich ausgefüllt und als Dokument gespeichert!'
        });
        
    } catch (error) {
        console.error('❌ Template Response Fehler:', error);
        res.status(500).json({ error: 'Fehler beim Verarbeiten der Antworten: ' + error.message });
    }
});

// Alle G-Docs Templates abrufen
app.get('/api/gdocs-templates', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM gdocs_templates ORDER BY created_at DESC');
        res.json(result.rows || []);
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Einzelnes G-Docs Template abrufen
app.get('/api/gdocs-template/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await pool.query('SELECT * FROM gdocs_templates WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Template nicht gefunden' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Verfügbare Templates für Benutzer-Rang
app.get('/api/available-templates/:rank', async (req, res) => {
    const { rank } = req.params;
    
    try {
        const result = await pool.query(`SELECT * FROM gdocs_templates 
                WHERE available_ranks LIKE $1 OR available_ranks LIKE $2 
                ORDER BY created_at DESC`, 
                [`%${rank}%`, '%admin%']);
        res.json(result.rows || []);
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Template-Typen für Filterung abrufen
app.get('/api/template-types', async (req, res) => {
    console.log('📋 /api/template-types aufgerufen - Lade verfügbare Template-Typen');
    
    const query = `
        SELECT 
            gt.id,
            gt.name,
            gt.description,
            COUNT(d.id) as document_count
        FROM gdocs_templates gt
        LEFT JOIN template_responses tr ON gt.id = tr.template_id
        LEFT JOIN documents d ON tr.id = d.template_response_id
        GROUP BY gt.id, gt.name, gt.description
        ORDER BY gt.name ASC
    `;
    
    try {
        const templatesResult = await pool.query(query);
        
        console.log('📊 Template-Typen gefunden:', templatesResult.rows.length);
        
        // Zusätzlich manuelle Dokumente zählen
        const manualResult = await pool.query(`SELECT COUNT(*) as count FROM documents WHERE document_type = $1`, ['manual']);
        
        const result = {
            templates: templatesResult.rows || [],
            manualDocumentsCount: manualResult.rows[0] ? manualResult.rows[0].count : 0
        };
        
        console.log('📋 Template-Typen Antwort:', result);
        res.json(result);
    } catch (err) {
        console.error('❌ Fehler beim Laden der Template-Typen:', err);
        res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
    }
});

// Template-Antworten für Admin abrufen
app.get('/api/template-responses/:templateId', async (req, res) => {
    const { templateId } = req.params;
    
    try {
        const result = await pool.query(`SELECT tr.*, u.full_name, gt.name as template_name 
                FROM template_responses tr 
                LEFT JOIN users u ON tr.submitted_by = u.username 
                LEFT JOIN gdocs_templates gt ON tr.template_id = gt.id 
                WHERE tr.template_id = $1 
                ORDER BY tr.created_at DESC`, 
                [templateId]);
        res.json(result.rows || []);
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// G-Docs Template löschen
app.delete('/api/gdocs-templates/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const templateResult = await pool.query('SELECT name FROM gdocs_templates WHERE id = $1', [id]);
        
        if (templateResult.rows.length === 0) {
            return res.status(404).json({ error: 'Vorlage nicht gefunden' });
        }
        
        const template = templateResult.rows[0];
        
        // Erst zugehörige Antworten löschen
        await pool.query('DELETE FROM template_responses WHERE template_id = $1', [id]);
        
        // Dann Template löschen
        await pool.query('DELETE FROM gdocs_templates WHERE id = $1', [id]);
        
        // Log-Eintrag
        createLogEntry('GDOCS_TEMPLATE_DELETED', 'admin', 'admin', `G-Docs Vorlage "${template.name}" gelöscht`, null, req.ip);
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// DOCX-Datei herunterladen
app.get('/api/download-template/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await pool.query('SELECT * FROM gdocs_templates WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Vorlage nicht gefunden' });
        }
        
        const template = result.rows[0];
        const filePath = template.file_path;
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Datei nicht gefunden' });
        }
        
        res.download(filePath, template.original_filename, (err) => {
            if (err) {
                console.error('Download-Fehler:', err);
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// Generierte DOCX-Datei herunterladen
app.get('/api/download-generated/:documentId', async (req, res) => {
    const { documentId } = req.params;
    
    console.log('📥 Download-Anfrage für Dokument ID:', documentId);
    
    try {
        const result = await pool.query(`SELECT d.*, u.full_name as creator_full_name 
                FROM documents d
                LEFT JOIN users u ON d.created_by = u.username 
                WHERE d.id = $1`, [documentId]);
        
        if (result.rows.length === 0) {
            console.error('❌ Dokument nicht gefunden:', documentId);
            return res.status(404).json({ error: 'Dokument nicht gefunden' });
        }
        
        const document = result.rows[0];
        
        if (!document.generated_docx_path || !document.generated_filename) {
            console.error('❌ Keine generierte DOCX-Datei für Dokument:', documentId);
            return res.status(404).json({ error: 'Keine generierte DOCX-Datei verfügbar' });
        }
        
        const filePath = document.generated_docx_path;
        
        if (!fs.existsSync(filePath)) {
            console.error('❌ DOCX-Datei nicht gefunden:', filePath);
            return res.status(404).json({ error: 'DOCX-Datei nicht gefunden auf Server' });
        }
        
        console.log('📄 Sende DOCX-Datei:', filePath);
        
        // Log-Eintrag für Download
        createLogEntry('DOCX_DOWNLOADED', 'system', 'system', `DOCX-Datei "${document.generated_filename}" heruntergeladen`, document.created_by, req.ip);
        
        res.download(filePath, document.generated_filename, (err) => {
            if (err) {
                console.error('❌ Download-Fehler:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Download-Fehler' });
                }
            } else {
                console.log('✅ Download erfolgreich:', document.generated_filename);
            }
        });
    } catch (err) {
        console.error('❌ DB-Fehler beim Download:', err);
        res.status(500).json({ error: 'Datenbankfehler' });
    }
});

// HTML-Vorschau der generierten DOCX-Datei
app.get('/api/preview-generated/:documentId', async (req, res) => {
    const { documentId } = req.params;
    
    console.log('👁️ Vorschau-Anfrage für Dokument ID:', documentId);
    
    try {
        const result = await pool.query(`SELECT d.*, u.full_name as creator_full_name 
                FROM documents d
                LEFT JOIN users u ON d.created_by = u.username 
                WHERE d.id = $1`, [documentId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Dokument nicht gefunden' });
        }
        
        const document = result.rows[0];
        
        if (!document.generated_docx_path) {
            return res.status(404).json({ error: 'Keine generierte DOCX-Datei verfügbar' });
        }
        
        if (!fs.existsSync(document.generated_docx_path)) {
            return res.status(404).json({ error: 'DOCX-Datei nicht gefunden auf Server' });
        }
        
        // Prüfe ob HTML-Vorschau bereits existiert in DB
        if (document.preview_html) {
            console.log('📄 Verwende gespeicherte HTML-Vorschau');
            return res.json({
                success: true,
                html: document.preview_html,
                documentInfo: {
                    name: document.full_name,
                    purpose: document.purpose,
                    created: document.created_at,
                    filename: document.generated_filename
                }
            });
        }
        
        // HTML-Vorschau generieren
        console.log('🔄 Generiere HTML-Vorschau...');
        const htmlContent = await convertDocxToHtml(document.generated_docx_path);
        
        // HTML-Vorschau in DB speichern für zukünftige Aufrufe
        await pool.query('UPDATE documents SET preview_html = $1 WHERE id = $2', 
                         [htmlContent, documentId]);
        
        console.log('✅ HTML-Vorschau in DB gespeichert');
        
        // Log-Eintrag für Vorschau
        createLogEntry('DOCX_PREVIEWED', 'system', 'system', `DOCX-Vorschau für "${document.generated_filename}" angezeigt`, document.created_by, req.ip);
        
        res.json({
            success: true,
            html: htmlContent,
            documentInfo: {
                name: document.full_name,
                purpose: document.purpose,
                created: document.created_at,
                filename: document.generated_filename,
                creator: document.creator_full_name || document.created_by
            }
        });
        
    } catch (error) {
        console.error('❌ Vorschau-Fehler:', error);
        res.status(500).json({ error: 'Fehler beim Generieren der Vorschau: ' + error.message });
    }
});

// Statistiken abrufen
app.get('/api/stats', async (req, res) => {
    try {
        const stats = {
            totalUsers: 0,
            pendingRegistrations: 0,
            activeUsers: 0,
            totalDocuments: 0,
            manualDocuments: 0,
            templateDocuments: 0
        };
        
        // Benutzer zählen
        const usersResult = await pool.query('SELECT COUNT(*) as count FROM users');
        stats.totalUsers = parseInt(usersResult.rows[0].count);
        
        // Aktive Benutzer zählen
        const activeUsersResult = await pool.query('SELECT COUNT(*) as count FROM users WHERE status = $1', ['approved']);
        stats.activeUsers = parseInt(activeUsersResult.rows[0].count);
        
        // Pending Registrierungen zählen
        const pendingResult = await pool.query('SELECT COUNT(*) as count FROM registrations WHERE status = $1', ['pending']);
        stats.pendingRegistrations = parseInt(pendingResult.rows[0].count);
        
        // Dokumente zählen
        const documentsResult = await pool.query('SELECT COUNT(*) as count FROM documents');
        stats.totalDocuments = parseInt(documentsResult.rows[0].count);
        
        const manualResult = await pool.query('SELECT COUNT(*) as count FROM documents WHERE document_type = $1', ['manual']);
        stats.manualDocuments = parseInt(manualResult.rows[0].count);
        
        const templateResult = await pool.query('SELECT COUNT(*) as count FROM documents WHERE document_type = $1', ['template']);
        stats.templateDocuments = parseInt(templateResult.rows[0].count);
        
        console.log('📊 Statistiken erstellt:', stats);
        res.json(stats);
    } catch (err) {
        console.error('❌ Fehler beim Erstellen der Statistiken:', err);
        res.json({
            totalUsers: 0,
            pendingRegistrations: 0,
            activeUsers: 0,
            totalDocuments: 0,
            manualDocuments: 0,
            templateDocuments: 0
        });
    }
});

// Log-Eintrag für Dokument-Ansicht
app.post('/api/log-document-view', async (req, res) => {
    const { documentId, viewedBy, viewMode } = req.body;
    
    if (!documentId || !viewedBy) {
        return res.status(400).json({ error: 'Dokument-ID und Betrachter sind erforderlich' });
    }
    
    // Log-Eintrag erstellen
    const action = viewMode === 'all' ? 'DOCUMENT_VIEWED_ALL' : 'DOCUMENT_VIEWED_OWN';
    const details = `Dokument ID ${documentId} angesehen (${viewMode === 'all' ? 'Alle Dokumente' : 'Meine Dokumente'})`;
    
    createLogEntry(action, viewedBy, 'user', details, null, req.ip);
    
    res.json({ success: true });
});

// Test-Endpoint für Datenbank-Verbindung
app.get('/api/test-db', async (req, res) => {
    console.log('🧪 Datenbank-Test aufgerufen');
    
    try {
        // Teste Verbindung
        const result = await pool.query("SELECT NOW() as current_time");
        
        console.log('✅ PostgreSQL-Verbindung erfolgreich, Zeit:', result.rows[0].current_time);
        
        // Teste documents Tabelle
        const countResult = await pool.query("SELECT COUNT(*) as count FROM documents");
        
        console.log('✅ Documents Tabelle verfügbar, Anzahl Einträge:', countResult.rows[0].count);
        
        res.json({ 
            success: true, 
            database_time: result.rows[0].current_time,
            documents_table: true,
            documents_count: parseInt(countResult.rows[0].count)
        });
    } catch (err) {
        console.error('❌ Datenbank-Test fehlgeschlagen:', err);
        res.status(500).json({ 
            success: false,
            error: err.message,
            database_time: null,
            documents_table: false
        });
    }
});

// Database Admin Interface
app.get('/admin/database', (req, res) => {
    res.send(`
        <html>
        <head><title>Database Admin</title></head>
        <body style="font-family: Arial; padding: 20px;">
            <h1>🗃️ Database Admin Interface (PostgreSQL)</h1>
            <form action="/admin/sql" method="post">
                <label>SQL Query:</label><br>
                <textarea name="query" rows="5" cols="80" placeholder="SELECT * FROM users;"></textarea><br><br>
                <button type="submit">Execute Query</button>
            </form>
        </body>
        </html>
    `);
});

// SQL Query Executor
app.post('/admin/sql', express.urlencoded({ extended: true }), async (req, res) => {
    const { query } = req.body;
    
    try {
        if (query.toLowerCase().startsWith('select')) {
            // Read-only queries
            const result = await pool.query(query);
            res.json({ success: true, data: result.rows });
        } else {
            // Write queries (ALTER, UPDATE, DELETE, etc.)
            const result = await pool.query(query);
            res.json({ success: true, rowCount: result.rowCount });
        }
    } catch (err) {
        res.json({ error: err.message });
    }
});

// Server starten
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🏛️ Regierungspanel v23-PostgreSQL Backend läuft auf http://localhost:${PORT}`);
    console.log(`📊 PostgreSQL Datenbank verbunden`);
    console.log(`📈 Rang-System aktiviert mit 8 verschiedenen Rängen`);
    console.log(`✅ Username-Änderungen aktiviert`);
    console.log(`📜 System-Log aktiviert`);
    console.log(`📝 G-Docs Funktion aktiviert`);
    console.log(`📋 Erweiterte Fragebogen-Funktionalität aktiviert`);
    console.log(`🔍 Debug-Modus für Dokumente-System aktiviert`);
    console.log(`🧪 Test-Endpoint verfügbar: GET /api/test-db`);
    console.log(`🗑️ FIXED: Dokument-Löschung funktioniert jetzt (DELETE /api/documents/:id)`);
    console.log(`📋 FIXED: Fragebögen werden jetzt automatisch als Dokumente gespeichert`);
    console.log(`✅ Version 23-PostgreSQL - Alle Dokument-Funktionen arbeiten korrekt mit PostgreSQL`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    try {
        await pool.end();
        console.log('✅ PostgreSQL Pool geschlossen.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Fehler beim Schließen der Datenbankverbindung:', err);
        process.exit(1);
    }
});
