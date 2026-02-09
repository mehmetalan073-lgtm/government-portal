/**
 * SERVER.JS - OPTIMIZED FOR RAILWAY & POSTGRESQL
 * Enthält automatische Syntax-Übersetzung von SQLite (?) zu PostgreSQL ($1)
 */

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs'); // Optimiert: bcryptjs statt bcrypt
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const mammoth = require('mammoth');

// --- KONFIGURATION & VERZEICHNISSE ---
const app = express();
const PORT = process.env.PORT || 3000;

// Pfade robust setzen (Railway vs Lokal)
const uploadsBasePath = process.env.NODE_ENV === 'production' ? '/app/data/uploads' : 'uploads';
const generatedDir = path.join(uploadsBasePath, 'generated/');
const templatesDir = path.join(uploadsBasePath, 'templates/');

// Sicherstellen, dass Verzeichnisse existieren
[uploadsBasePath, generatedDir, templatesDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- MIDDLEWARE ---
app.use(express.json({ limit: '50mb' })); // Erhöhtes Limit für große Uploads
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? true : '*', // Erlaubt alle im Dev-Mode
    credentials: true
}));
app.use(express.static('public'));

// --- MULTER (DATEI UPLOAD) ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, templatesDir);
    },
    filename: function (req, file, cb) {
        // Bereinigt Dateinamen und fügt Timestamp hinzu
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        cb(null, `template-${Date.now()}-${cleanName}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.includes('wordprocessingml') || file.originalname.endsWith('.docx')) {
            cb(null, true);
        } else {
            cb(new Error('Nur .docx Dateien erlaubt!'), false);
        }
    }
});

// --- DATENBANK VERBINDUNG (POSTGRESQL) ---
console.log('🔌 Verbinde mit Datenbank...');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20, // Maximale Verbindungen im Pool
    idleTimeoutMillis: 30000
});

// --- INTELLIGENTER DB WRAPPER (Das Herzstück der Optimierung) ---
// Dieser Wrapper sorgt dafür, dass dein alter Code (mit ?) auch mit Postgres ($1) funktioniert.
const db = {
    // Hilfsfunktion: Wandelt ? in $1, $2, $3 um
    _convertQuery: (sql) => {
        let i = 1;
        // Ersetzt jedes ? durch $1, $2 usw.
        let converted = sql.replace(/\?/g, () => `$${i++}`);
        
        // AUTO-FIX: PostgreSQL braucht 'RETURNING id' für INSERTs, um die ID zurückzugeben
        if (converted.trim().toUpperCase().startsWith('INSERT') && !converted.toUpperCase().includes('RETURNING')) {
            converted += ' RETURNING id';
        }
        return converted;
    },

    // db.run (für INSERT, UPDATE, DELETE)
    run: function(sql, params = [], callback) {
        if (typeof params === 'function') { callback = params; params = []; }
        
        const pgSql = this._convertQuery(sql);
        // console.log(`🔍 SQL EXEC: ${pgSql}`, params); // Uncomment for Debugging

        pool.query(pgSql, params, (err, result) => {
            if (callback) {
                // Simuliere SQLite "this" Context
                const context = {
                    lastID: result?.rows?.[0]?.id || 0, // Holt die ID bei INSERT
                    changes: result?.rowCount || 0
                };
                callback.call(context, err);
            }
        });
    },

    // db.get (für einzelne Zeile)
    get: function(sql, params = [], callback) {
        if (typeof params === 'function') { callback = params; params = []; }
        const pgSql = this._convertQuery(sql);

        pool.query(pgSql, params, (err, result) => {
            if (err) return callback(err);
            callback(null, result.rows[0]); // Gibt undefined zurück wenn nichts gefunden (wie SQLite)
        });
    },

    // db.all (für Listen)
    all: function(sql, params = [], callback) {
        if (typeof params === 'function') { callback = params; params = []; }
        const pgSql = this._convertQuery(sql);

        pool.query(pgSql, params, (err, result) => {
            if (err) return callback(err);
            callback(null, result.rows || []);
        });
    },

    // db.serialize (Dummy für Kompatibilität)
    serialize: (cb) => { if(cb) cb(); }
};

// --- INITIALISIERUNG ---
async function initializeDatabase() {
    console.log('🗃️ Prüfe Tabellen-Struktur...');
    try {
        // Tabellen erstellen (Syntax für PostgreSQL optimiert)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                rank TEXT DEFAULT 'besucher',
                role TEXT DEFAULT 'user',
                status TEXT DEFAULT 'approved',
                dark_mode INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                approved_by TEXT,
                approved_at TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS registrations (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                reason TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                approved_by TEXT,
                approved_at TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS documents (
                id SERIAL PRIMARY KEY,
                full_name TEXT NOT NULL,
                birth_date TEXT,
                address TEXT,
                phone TEXT,
                purpose TEXT NOT NULL,
                application_date TEXT,
                additional_info TEXT,
                created_by TEXT NOT NULL,
                template_response_id INTEGER,
                document_type TEXT DEFAULT 'manual',
                generated_docx_path TEXT,
                generated_filename TEXT,
                file_number TEXT,
                preview_html TEXT,
                docx_data BYTEA, -- Für direkte Speicherung
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS system_log (
                id SERIAL PRIMARY KEY,
                action TEXT NOT NULL,
                performed_by TEXT NOT NULL,
                user_rank TEXT,
                details TEXT,
                target_user TEXT,
                ip_address TEXT,
                session_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS gdocs_templates (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                file_path TEXT NOT NULL,
                original_filename TEXT,
                available_ranks TEXT NOT NULL,
                questions TEXT,
                created_by TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS template_responses (
                id SERIAL PRIMARY KEY,
                template_id INTEGER NOT NULL,
                answers TEXT NOT NULL,
                submitted_by TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS file_counters (
                id SERIAL PRIMARY KEY,
                prefix TEXT NOT NULL UNIQUE,
                current_number INTEGER DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS username_change_requests (
                id SERIAL PRIMARY KEY,
                current_username TEXT NOT NULL,
                new_username TEXT NOT NULL,
                reason TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                approved_by TEXT,
                approved_at TIMESTAMP
            );
        `);

        // Counter initialisieren
        await pool.query(`INSERT INTO file_counters (prefix, current_number) VALUES ('B', 0) ON CONFLICT (prefix) DO NOTHING`);

        // Admin erstellen falls nicht existent
        const adminHash = bcrypt.hashSync('memo', 10);
        await pool.query(`
            INSERT INTO users (username, password_hash, full_name, rank, role, status) 
            VALUES ($1, $2, $3, 'admin', 'admin', 'approved') 
            ON CONFLICT (username) DO NOTHING`, 
            ['admin', adminHash, 'Systemadministrator']
        );

        console.log('✅ Datenbank erfolgreich initialisiert.');
    } catch (e) {
        console.error('❌ Fehler bei Initialisierung:', e);
    }
}

// --- HILFSFUNKTIONEN ---

// Log Eintrag erstellen
function createLogEntry(action, performedBy, userRank, details, targetUser = null, ip = null) {
    db.run(
        "INSERT INTO system_log (action, performed_by, user_rank, details, target_user, ip_address) VALUES (?, ?, ?, ?, ?, ?)",
        [action, performedBy, userRank, details, targetUser, ip]
    );
}

// Nächste Aktennummer (B-Nummer) generieren
async function getNextFileNumber() {
    return new Promise((resolve, reject) => {
        // Nutze PG Syntax für inkrementieren und zurückgeben in einem Schritt
        pool.query("UPDATE file_counters SET current_number = current_number + 1, updated_at = CURRENT_TIMESTAMP WHERE prefix = $1 RETURNING current_number", ['B'], (err, res) => {
            if (err) return reject(err);
            const num = res.rows[0].current_number;
            const formatted = `#B${num.toString().padStart(4, '0')}-SOCOM`;
            resolve(formatted);
        });
    });
}

// DOCX Generierung
async function generateDocxFromTemplate(templatePath, answers, outputFilename, submittedBy, templateName) {
    console.log(`📄 Generiere DOCX: ${outputFilename}`);
    
    // 1. Datei einlesen
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    // 2. Daten vorbereiten (flachklopfen)
    const cleanData = {};
    Object.keys(answers).forEach(key => {
        // Entfernt "field-" Prefix für saubere Variablen im Word-Dokument
        const cleanKey = key.replace('field-', '');
        cleanData[key] = answers[key];
        cleanData[cleanKey] = answers[key];
    });

    // 3. System-Variablen hinzufügen
    const fileNumber = await getNextFileNumber();
    const now = new Date();
    
    Object.assign(cleanData, {
        fileNumber: fileNumber,
        generatedDate: now.toLocaleDateString('de-DE'),
        currentUser: submittedBy,
        templateName: templateName
    });

    // 4. Rendern
    try {
        doc.render(cleanData);
    } catch (error) {
        console.error("Docx Render Error:", error);
        throw error;
    }

    // 5. Buffer und Datei erstellen
    const buf = doc.getZip().generate({ type: 'nodebuffer', compression: "DEFLATE" });
    const outputPath = path.join(generatedDir, outputFilename);
    fs.writeFileSync(outputPath, buf);

    return { path: outputPath, fileNumber: fileNumber, buffer: buf };
}

// --- ROUTEN ---

// Root
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) return res.status(500).json({ error: "DB Fehler" });
        if (!user) return res.status(401).json({ error: "Benutzer nicht gefunden" });
        
        if (bcrypt.compareSync(password, user.password_hash)) {
            if (user.status !== 'approved') return res.status(403).json({ error: "Account noch nicht freigeschaltet" });
            
            createLogEntry('LOGIN', username, user.rank, 'Login erfolgreich', null, req.ip);
            res.json({ success: true, user: { 
                username: user.username, 
                fullName: user.full_name, 
                rank: user.rank,
                role: user.role,
                darkMode: user.dark_mode === 1 
            }});
        } else {
            res.status(401).json({ error: "Falsches Passwort" });
        }
    });
});

// Registrierung
app.post('/api/register', (req, res) => {
    const { username, password, fullName, reason } = req.body;
    if (password.length < 6) return res.status(400).json({ error: "Passwort zu kurz" });

    const hash = bcrypt.hashSync(password, 10);
    
    // Nutze den Wrapper, der INSERT ... RETURNING id automatisch handhabt
    db.run("INSERT INTO registrations (username, password_hash, full_name, reason) VALUES (?, ?, ?, ?)", 
        [username, hash, fullName, reason], 
        function(err) {
            if (err) {
                if(err.message.includes('unique')) return res.status(400).json({ error: "Benutzername vergeben" });
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, registrationId: this.lastID });
        }
    );
});

// Admin: Offene Anträge
app.get('/api/pending-registrations', (req, res) => {
    db.all("SELECT * FROM registrations WHERE status = 'pending' ORDER BY created_at DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Admin: Genehmigen
app.post('/api/approve-registration/:id', (req, res) => {
    const { id } = req.params;
    const { adminUsername } = req.body;

    db.get("SELECT * FROM registrations WHERE id = ?", [id], (err, reg) => {
        if (!reg) return res.status(404).json({ error: "Antrag nicht gefunden" });

        db.run("INSERT INTO users (username, password_hash, full_name, approved_by, approved_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
            [reg.username, reg.password_hash, reg.full_name, adminUsername],
            (err) => {
                if (err) return res.status(500).json({ error: "Fehler beim Erstellen des Users: " + err.message });
                
                db.run("UPDATE registrations SET status = 'approved' WHERE id = ?", [id], () => {
                    createLogEntry('USER_APPROVED', adminUsername, 'admin', `User ${reg.username} genehmigt`, reg.username, req.ip);
                    res.json({ success: true });
                });
            }
        );
    });
});

// Admin: Ablehnen
app.post('/api/reject-registration/:id', (req, res) => {
    const { id } = req.params;
    db.run("UPDATE registrations SET status = 'rejected' WHERE id = ?", [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Dokument erstellen (Manuell)
app.post('/api/create-document', (req, res) => {
    const { fullName, birthDate, address, phone, purpose, applicationDate, additional, createdBy } = req.body;
    
    db.run(`INSERT INTO documents (full_name, birth_date, address, phone, purpose, application_date, additional_info, created_by, document_type) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
            [fullName, birthDate, address, phone, purpose, applicationDate, additional, createdBy],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                createLogEntry('DOC_CREATED', createdBy, 'user', `Dokument: ${purpose}`, null, req.ip);
                res.json({ success: true, documentId: this.lastID });
            }
    );
});

// G-Docs Template erstellen
app.post('/api/create-gdocs-template', upload.single('templateFile'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Keine Datei" });
    
    const { name, description, createdBy, availableRanks, questions } = req.body;
    
    // Arrays müssen für die DB oft als String gespeichert werden (oder JSONB in PG, hier Text für Kompatibilität)
    // Wir speichern es einfach als String/JSON-String wie im Original-Code erwartet
    
    db.run("INSERT INTO gdocs_templates (name, description, file_path, original_filename, available_ranks, questions, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [name, description, req.file.path, req.file.originalname, availableRanks, questions, createdBy],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            createLogEntry('TEMPLATE_CREATED', createdBy, 'admin', `Template: ${name}`, null, req.ip);
            res.json({ success: true, templateId: this.lastID });
        }
    );
});

// Verfügbare Templates laden
app.get('/api/available-templates/:rank', (req, res) => {
    const { rank } = req.params;
    // Suche nach Templates, die den Rang enthalten ODER 'admin' (Admins sehen alles)
    // PostgreSQL LIKE ist case-sensitive, ILIKE ist case-insensitive.
    // Wir nutzen hier den Wrapper, der ? nutzt.
    db.all("SELECT * FROM gdocs_templates WHERE available_ranks LIKE ? OR available_ranks LIKE ?", 
        [`%${rank}%`, '%admin%'], 
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// Fragebogen absenden & DOCX generieren
app.post('/api/submit-template-response', async (req, res) => {
    const { templateId, answers, submittedBy } = req.body;

    try {
        // 1. Template laden
        const template = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM gdocs_templates WHERE id = ?", [templateId], (err, row) => err ? reject(err) : resolve(row));
        });

        if (!template) return res.status(404).json({ error: "Template nicht gefunden" });

        // 2. Antwort speichern
        const answersStr = JSON.stringify(answers);
        const responseId = await new Promise((resolve, reject) => {
            db.run("INSERT INTO template_responses (template_id, answers, submitted_by) VALUES (?, ?, ?)", 
                [templateId, answersStr, submittedBy], 
                function(err) { err ? reject(err) : resolve(this.lastID); }
            );
        });

        // 3. DOCX Generieren
        let generatedInfo = null;
        let docxBuffer = null;
        
        if (fs.existsSync(template.file_path)) {
            const filename = `gen-${Date.now()}-${submittedBy}.docx`;
            generatedInfo = await generateDocxFromTemplate(template.file_path, answers, filename, submittedBy, template.name);
            docxBuffer = generatedInfo.buffer;
        }

        // 4. Eintrag in Documents Tabelle
        // Extrahieren von Basisdaten aus Antworten für die Suche
        const fullName = answers['field-1'] || answers['Name'] || submittedBy; // Versuche Name zu raten
        const purpose = `Fragebogen: ${template.name}`;
        
        // WICHTIG: PG unterstützt BYTEA für Buffer. Wir übergeben den Buffer direkt.
        // Der Wrapper gibt Params direkt an pg weiter, das Buffer unterstützt.
        
        db.run(`INSERT INTO documents (full_name, purpose, created_by, template_response_id, document_type, generated_docx_path, generated_filename, file_number, docx_data) 
                VALUES (?, ?, ?, ?, 'template', ?, ?, ?, ?)`,
                [fullName, purpose, submittedBy, responseId, generatedInfo?.path, generatedInfo?.path ? path.basename(generatedInfo.path) : null, generatedInfo?.fileNumber, docxBuffer],
                (err) => {
                    if (err) console.error("Fehler beim Speichern des Dokuments:", err); // Nicht blockieren
                }
        );

        createLogEntry('TEMPLATE_SUBMITTED', submittedBy, 'user', `Fragebogen ausgefüllt: ${template.name}`, null, req.ip);

        res.json({ 
            success: true, 
            fileNumber: generatedInfo?.fileNumber,
            message: "Erfolgreich eingereicht!" 
        });

    } catch (error) {
        console.error("Submit Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Dokumente laden (Meine oder Alle)
app.get('/api/documents/:username', (req, res) => {
    // Wenn 'all-documents' angefordert wird (z.B. durch Admin-Logik im Frontend, die Username manipuliert, oder separate Route)
    // Hier einfache Logik:
    const sql = "SELECT * FROM documents WHERE created_by = ? ORDER BY created_at DESC";
    db.all(sql, [req.params.username], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/all-documents', (req, res) => {
    db.all("SELECT * FROM documents ORDER BY created_at DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Download DOCX
app.get('/api/download-generated/:id', (req, res) => {
    db.get("SELECT * FROM documents WHERE id = ?", [req.params.id], (err, doc) => {
        if (!doc) return res.status(404).json({ error: "Nicht gefunden" });
        
        // Strategie 1: Puffer aus DB
        if (doc.docx_data) {
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.setHeader('Content-Disposition', `attachment; filename="${doc.generated_filename || 'dokument.docx'}"`);
            return res.send(doc.docx_data);
        }

        // Strategie 2: Datei vom Server
        if (doc.generated_docx_path && fs.existsSync(doc.generated_docx_path)) {
            return res.download(doc.generated_docx_path, doc.generated_filename);
        }

        res.status(404).json({ error: "Datei physisch nicht vorhanden" });
    });
});

// Stats für Admin Dashboard
app.get('/api/stats', (req, res) => {
    const stats = { totalUsers: 0, pendingRegistrations: 0, activeUsers: 0 };
    
    // Wir nutzen Promises für sauberen Ablauf
    Promise.all([
        new Promise(r => db.all("SELECT COUNT(*) as c FROM users", [], (e, rows) => r(rows?.[0]?.c || 0))),
        new Promise(r => db.all("SELECT COUNT(*) as c FROM registrations WHERE status='pending'", [], (e, rows) => r(rows?.[0]?.c || 0))),
        new Promise(r => db.all("SELECT COUNT(*) as c FROM users WHERE status='approved'", [], (e, rows) => r(rows?.[0]?.c || 0)))
    ]).then(([users, pending, active]) => {
        // PG gibt count oft als String zurück (BigInt), daher parseInt
        res.json({
            totalUsers: parseInt(users),
            pendingRegistrations: parseInt(pending),
            activeUsers: parseInt(active)
        });
    }).catch(err => res.status(500).json({ error: err.message }));
});

// --- SERVER START ---
initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Server läuft auf Port ${PORT}`);
        console.log(`📂 Upload-Pfad: ${uploadsBasePath}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'Development'}`);
    });
});

// Graceful Shutdown
process.on('SIGINT', () => {
    pool.end(() => {
        console.log('PostgreSQL Pool geschlossen.');
        process.exit(0);
    });
});