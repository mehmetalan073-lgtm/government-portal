// server.js v24 - KORRIGIERT: Frontend-kompatibel
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');

// DOCX-Processing Libraries
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const mammoth = require('mammoth');

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

// Generierte Dateien Verzeichnis
const generatedDir = 'uploads/generated/';
if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 3000;

// ===== KORRIGIERTE MIDDLEWARE =====
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 🔧 KORRIGIERTE CORS-Konfiguration FÜR RAILWAY
app.use(cors({
    origin: true,  // Erlaubt alle Origins (Railway-kompatibel)
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// 🔧 KORRIGIERTES Static File Serving
app.use('/uploads', express.static('uploads'));
app.use(express.static('.', {
    dotfiles: 'ignore',
    etag: false,
    extensions: ['html', 'js', 'css'],
    index: 'index.html',
    maxAge: '1d',
    redirect: false,
    setHeaders: function (res, path, stat) {
        res.set('x-timestamp', Date.now())
        res.set('Cache-Control', 'no-cache');
    }
}));

// Root route - serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// SQLite Datenbank initialisieren
const db = new sqlite3.Database('government_portal.db', (err) => {
    if (err) {
        console.error('❌ Datenbankfehler:', err);
    } else {
        console.log('✅ Datenbank verbunden');
    }
});

// HILFSFUNKTIONEN

// Log-Eintrag erstellen
function createLogEntry(action, performedBy, userRank, details, targetUser = null, ipAddress = null) {
    db.run(`INSERT INTO system_log (action, performed_by, user_rank, details, target_user, ip_address) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [action, performedBy, userRank, details, targetUser, ipAddress], (err) => {
                if (err) console.error('Log Fehler:', err);
            });
}

// Nächste B-Nummer generieren
async function getNextFileNumber() {
    return new Promise((resolve, reject) => {
        console.log('📊 Generiere nächste B-Nummer (Bewertung)...');
        
        db.get('SELECT current_number FROM file_counters WHERE prefix = ?', ['B'], (err, row) => {
            if (err) {
                console.error('❌ Fehler beim Laden des B-Counters:', err);
                return reject(err);
            }
            
            const currentNumber = row ? row.current_number : 0;
            const nextNumber = currentNumber + 1;
            
            db.run('UPDATE file_counters SET current_number = ?, updated_at = CURRENT_TIMESTAMP WHERE prefix = ?', 
                   [nextNumber, 'B'], (err) => {
                if (err) {
                    console.error('❌ Fehler beim Update des B-Counters:', err);
                    return reject(err);
                }
                
                const formattedNumber = nextNumber.toString().padStart(4, '0');
                const fileNumber = `#B${formattedNumber}-SOCOM`;
                
                console.log(`✅ Neue B-Nummer generiert: ${fileNumber}`);
                resolve(fileNumber);
            });
        });
    });
}

// DOCX aus Template generieren
async function generateDocxFromTemplate(templatePath, answers, outputFilename, submittedBy, templateName = '') {
    try {
        console.log('📄 Generiere DOCX aus Template:', templatePath);
        
        const templateContent = fs.readFileSync(templatePath, 'binary');
        const zip = new PizZip(templateContent);
        const doc = new Docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
        });
        
        const templateData = {};
        
        // Konvertiere field-X zu readable names
        Object.entries(answers).forEach(([key, value]) => {
            const cleanKey = key.replace('field-', '');
            templateData[cleanKey] = Array.isArray(value) ? value.join(', ') : value;
            templateData[key] = Array.isArray(value) ? value.join(', ') : value;
        });
        
        // Lade Benutzerdaten
        const userData = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE username = ?', [submittedBy], (err, user) => {
                if (err) reject(err);
                else resolve(user || {});
            });
        });
        
        // Generiere automatische B-File-Nummer
        const fileNumber = await getNextFileNumber();
        console.log('🔢 Automatische B-Nummer:', fileNumber);
        
        // Template-Daten hinzufügen
        const now = new Date();
        
        // File-Nummer
        templateData.fileNumber = fileNumber;
        templateData.fileNumberWithoutHash = fileNumber.replace('#', '');
        templateData.fileNumberOnly = fileNumber.match(/\d+/)?.[0] || '0001';
        templateData.filePrefix = 'B';
        templateData.fileSuffix = 'SOCOM';
        
        // Datum & Zeit
        templateData.generatedDate = now.toLocaleDateString('de-DE');
        templateData.generatedTime = now.toLocaleTimeString('de-DE');
        templateData.generatedDateTime = now.toLocaleString('de-DE');
        templateData.currentYear = now.getFullYear().toString();
        templateData.currentMonth = (now.getMonth() + 1).toString().padStart(2, '0');
        templateData.currentDay = now.getDate().toString().padStart(2, '0');
        
        // Benutzer-Daten
        templateData.currentUser = submittedBy;
        templateData.currentUserName = userData.full_name || submittedBy;
        templateData.currentUserEmail = userData.email || '';
        templateData.currentUserRank = userData.rank || 'user';
        templateData.currentUserRankDisplay = getRankDisplay(userData.rank || 'user');
        
        // System-Daten
        templateData.systemName = 'Regierungspanel';
        templateData.templateName = templateName;
        
        // Deutsche Formatierung
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
        
        return { 
            path: outputPath, 
            fileNumber: fileNumber 
        };
        
    } catch (error) {
        console.error('❌ DOCX Generation Fehler:', error);
        throw error;
    }
}

// DOCX zu HTML für Vorschau konvertieren
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

// Eindeutigen Dateinamen generieren
function generateUniqueFilename(templateName, submittedBy) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedTemplateName = templateName.replace(/[^a-zA-Z0-9]/g, '_');
    const sanitizedUsername = submittedBy.replace(/[^a-zA-Z0-9]/g, '_');
    
    return `${sanitizedTemplateName}_${sanitizedUsername}_${timestamp}.docx`;
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

// Admin-Berechtigungen prüfen
function hasFullAccessServer(rank) {
    const fullAccessRanks = ['nc-team', 'president', 'vice-president', 'admin'];
    return fullAccessRanks.includes(rank);
}

// Benutzer-Berechtigungen abrufen
async function getUserPermissions(username) {
    return new Promise((resolve, reject) => {
        db.get('SELECT username, rank, full_name FROM users WHERE username = ? AND status = "approved"', 
               [username], (err, user) => {
            if (err) {
                reject(err);
            } else if (!user) {
                reject(new Error('Benutzer nicht gefunden oder nicht genehmigt'));
            } else {
                const hasFullAccess = hasFullAccessServer(user.rank || 'user');
                resolve({
                    username: user.username,
                    rank: user.rank || 'user',
                    fullName: user.full_name,
                    hasFullAccess: hasFullAccess,
                    canEditTemplates: hasFullAccess
                });
            }
        });
    });
}

// DATENBANK-INITIALISIERUNG

// File Counters Tabelle (außerhalb von serialize)
db.run(`CREATE TABLE IF NOT EXISTS file_counters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prefix TEXT NOT NULL UNIQUE,
    current_number INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`, (err) => {
    if (!err) {
        console.log('✅ File Counters Tabelle erstellt');
        
        // Nur B-Counter initialisieren
        db.run(`INSERT OR IGNORE INTO file_counters (prefix, current_number) VALUES ('B', 0)`, 
               (err) => {
            if (!err) {
                console.log('✅ B-Counter (Bewertung) initialisiert');
            }
        });
    }
});

// Haupttabellen erstellen
db.serialize(() => {
    // Users Tabelle mit Rang-System
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        rank TEXT DEFAULT 'user',
        role TEXT DEFAULT 'user',
        status TEXT DEFAULT 'approved',
        dark_mode INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved_by TEXT,
        approved_at DATETIME
    )`, (err) => {
        if (err) {
            console.log('Users Tabelle existiert bereits');
        }
        
        // Migration: Füge fehlende Spalten hinzu
        db.all("PRAGMA table_info(users)", (err, columns) => {
            if (!err && columns) {
                const columnNames = columns.map(col => col.name);
                
                if (!columnNames.includes('rank')) {
                    db.run("ALTER TABLE users ADD COLUMN rank TEXT DEFAULT 'user'", (err) => {
                        if (!err) {
                            console.log('✅ rank Spalte erfolgreich hinzugefügt');
                            db.run("UPDATE users SET rank = 'admin' WHERE username = 'admin'");
                        }
                    });
                }
                
                if (!columnNames.includes('dark_mode')) {
                    db.run("ALTER TABLE users ADD COLUMN dark_mode INTEGER DEFAULT 0", (err) => {
                        if (!err) {
                            console.log('✅ dark_mode Spalte erfolgreich hinzugefügt');
                        }
                    });
                }
            }
        });
    });

    // Registrations Tabelle
    db.run(`CREATE TABLE IF NOT EXISTS registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved_by TEXT,
        approved_at DATETIME
    )`);

    // Documents Tabelle (erweitert)
    db.run(`CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        birth_date TEXT,
        address TEXT,
        phone TEXT,
        email TEXT,
        purpose TEXT,
        application_date TEXT,
        additional_info TEXT,
        created_by TEXT NOT NULL,
        template_response_id INTEGER,
        document_type TEXT DEFAULT 'manual',
        generated_docx_path TEXT,
        generated_filename TEXT,
        file_number TEXT,
        preview_html TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(username),
        FOREIGN KEY (template_response_id) REFERENCES template_responses(id)
    )`, (err) => {
        if (err) {
            console.error('❌ Fehler beim Erstellen der Documents Tabelle:', err);
        } else {
            console.log('✅ Documents Tabelle erstellt/verifiziert');
            
            // Migration: Füge fehlende Spalten hinzu
            db.all("PRAGMA table_info(documents)", (err, columns) => {
                if (!err && columns) {
                    const columnNames = columns.map(col => col.name);
                    
                    const neededColumns = [
                        'template_response_id',
                        'document_type',
                        'generated_docx_path',
                        'generated_filename',
                        'file_number',
                        'preview_html'
                    ];
                    
                    neededColumns.forEach(column => {
                        if (!columnNames.includes(column)) {
                            let defaultValue = '';
                            if (column === 'document_type') defaultValue = " DEFAULT 'manual'";
                            
                            db.run(`ALTER TABLE documents ADD COLUMN ${column} TEXT${defaultValue}`, (err) => {
                                if (!err) {
                                    console.log(`✅ ${column} Spalte hinzugefügt`);
                                }
                            });
                        }
                    });
                }
            });
        }
    });

    // Username Change Requests Tabelle
    db.run(`CREATE TABLE IF NOT EXISTS username_change_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        current_username TEXT NOT NULL,
        new_username TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved_by TEXT,
        approved_at DATETIME
    )`, (err) => {
        if (!err) {
            console.log('✅ Username Change Requests Tabelle erstellt');
        }
    });

    // System Log Tabelle
    db.run(`CREATE TABLE IF NOT EXISTS system_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        performed_by TEXT NOT NULL,
        user_rank TEXT,
        details TEXT,
        target_user TEXT,
        ip_address TEXT,
        session_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (!err) {
            console.log('✅ System Log Tabelle erstellt');
        }
    });

    // G-Docs Templates Tabelle
    db.run(`CREATE TABLE IF NOT EXISTS gdocs_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        file_path TEXT NOT NULL,
        original_filename TEXT,
        available_ranks TEXT NOT NULL,
        questions TEXT,
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(username)
    )`, (err) => {
        if (err) {
            console.log('📋 gdocs_templates Tabelle existiert bereits');
        } else {
            console.log('✅ G-Docs Templates Tabelle erstellt');
        }
        
        // Migration: Füge fehlende Spalten hinzu
        db.all("PRAGMA table_info(gdocs_templates)", (err, columns) => {
            if (!err && columns) {
                const columnNames = columns.map(col => col.name);
                
                const neededColumns = ['questions', 'file_path', 'original_filename'];
                
                neededColumns.forEach(column => {
                    if (!columnNames.includes(column)) {
                        db.run(`ALTER TABLE gdocs_templates ADD COLUMN ${column} TEXT`, (err) => {
                            if (!err) {
                                console.log(`✅ ${column} Spalte zu gdocs_templates hinzugefügt`);
                            }
                        });
                    }
                });
            }
        });
    });

    // Template Responses Tabelle
    db.run(`CREATE TABLE IF NOT EXISTS template_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL,
        answers TEXT NOT NULL,
        submitted_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES gdocs_templates(id),
        FOREIGN KEY (submitted_by) REFERENCES users(username)
    )`, (err) => {
        if (!err) {
            console.log('✅ Template Responses Tabelle erstellt');
        }
    });

    // Admin-User erstellen
    const adminPassword = bcrypt.hashSync('memo', 10);
    db.get("SELECT * FROM users WHERE username = 'admin'", (err, user) => {
        if (!user) {
            db.run(`INSERT INTO users (username, password_hash, full_name, email, rank, role, status) 
                    VALUES ('admin', ?, 'Systemadministrator', 'admin@system.gov.de', 'admin', 'admin', 'approved')`, 
                    [adminPassword], (err) => {
                        if (!err) {
                            console.log('✅ Admin-User erfolgreich erstellt (Passwort: memo)');
                        }
                    });
        } else {
            if (!user.rank || user.rank !== 'admin') {
                db.run("UPDATE users SET rank = 'admin' WHERE username = 'admin'", (err) => {
                    if (!err) {
                        console.log('✅ Admin-User Rang aktualisiert');
                    }
                });
            }
        }
    });
});

// API ENDPOINTS

// ===== AUTHENTICATION =====

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    console.log('🔐 Login-Versuch für:', username);
    
    db.get('SELECT * FROM users WHERE username = ? AND status = "approved"', [username], (err, user) => {
        if (err) {
            console.error('❌ Datenbankfehler:', err);
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        
        if (!user) {
            console.log('❌ Benutzer nicht gefunden:', username);
            return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
        }
        
        if (!bcrypt.compareSync(password, user.password_hash)) {
            console.log('❌ Falsches Passwort für:', username);
            return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
        }
        
        console.log('✅ Login erfolgreich für:', username, 'Rang:', user.rank);
        
        createLogEntry('LOGIN', username, user.rank || 'user', `Benutzer angemeldet`, null, req.ip);
        
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                fullName: user.full_name,
                email: user.email,
                rank: user.rank || 'user',
                role: user.role,
                darkMode: user.dark_mode === 1
            }
        });
    });
});

// Registrierung beantragen
app.post('/api/register', (req, res) => {
    const { username, password, fullName, email, reason } = req.body;
    
    console.log('📝 Registrierungsantrag für:', username);
    
    if (!username || !password || !fullName || !email || !reason) {
        return res.status(400).json({ error: 'Alle Felder sind erforderlich' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });
    }
    
    const passwordHash = bcrypt.hashSync(password, 10);
    
    db.run(`INSERT INTO registrations (username, password_hash, full_name, email, reason) 
            VALUES (?, ?, ?, ?, ?)`, 
            [username, passwordHash, fullName, email, reason], 
            function(err) {
                if (err) {
                    console.error('❌ Registrierungsfehler:', err);
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: 'Benutzername bereits vergeben' });
                    }
                    return res.status(500).json({ error: 'Datenbankfehler' });
                }
                
                console.log('✅ Registrierung eingereicht:', username, 'ID:', this.lastID);
                res.json({ success: true, registrationId: this.lastID });
            });
});

// ===== ADMIN - REGISTRIERUNGEN =====

// Wartende Registrierungen abrufen
app.get('/api/pending-registrations', (req, res) => {
    db.all('SELECT * FROM registrations WHERE status = "pending" ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        res.json(rows || []);
    });
});

// Registrierung genehmigen
app.post('/api/approve-registration/:id', (req, res) => {
    const { id } = req.params;
    const { adminUsername } = req.body;
    
    db.get('SELECT * FROM registrations WHERE id = ?', [id], (err, registration) => {
        if (err || !registration) {
            return res.status(404).json({ error: 'Registrierung nicht gefunden' });
        }
        
        db.run(`INSERT INTO users (username, password_hash, full_name, email, rank, role, status, approved_by, approved_at) 
                VALUES (?, ?, ?, ?, 'besucher', 'user', 'approved', ?, CURRENT_TIMESTAMP)`,
                [registration.username, registration.password_hash, registration.full_name, 
                 registration.email, adminUsername], (err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Fehler beim Erstellen des Benutzers' });
                    }
                    
                    db.run(`UPDATE registrations SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?`,
                            [adminUsername, id], (err) => {
                                if (err) {
                                    return res.status(500).json({ error: 'Fehler beim Update der Registrierung' });
                                }
                                
                                createLogEntry('USER_APPROVED', adminUsername, 'admin', `Benutzer ${registration.username} genehmigt`, registration.username, req.ip);
                                
                                res.json({ success: true });
                            });
                });
    });
});

// Registrierung ablehnen
app.post('/api/reject-registration/:id', (req, res) => {
    const { id } = req.params;
    const { adminUsername } = req.body;
    
    db.get('SELECT * FROM registrations WHERE id = ?', [id], (err, registration) => {
        if (err || !registration) {
            return res.status(404).json({ error: 'Registrierung nicht gefunden' });
        }
        
        db.run(`UPDATE registrations SET status = 'rejected', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [adminUsername, id], (err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Datenbankfehler' });
                    }
                    
                    createLogEntry('USER_REJECTED', adminUsername, 'admin', `Registrierungsantrag von ${registration.username} abgelehnt`, registration.username, req.ip);
                    
                    res.json({ success: true });
                });
    });
});

// ===== ADMIN - BENUTZERVERWALTUNG =====

// Alle Benutzer abrufen
app.get('/api/users', (req, res) => {
    db.all('SELECT id, username, full_name, email, rank, role, status, created_at, approved_by, approved_at FROM users ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        res.json(rows || []);
    });
});

// Rang ändern
app.post('/api/update-rank/:id', (req, res) => {
    const { id } = req.params;
    const { rank, adminUsername } = req.body;
    
    const validRanks = ['nc-team', 'president', 'vice-president', 'admin', 'kabinettsmitglied', 
                        'socom-operator', 'user', 'besucher'];
    
    if (!validRanks.includes(rank)) {
        return res.status(400).json({ error: 'Ungültiger Rang' });
    }
    
    db.get('SELECT username FROM users WHERE id = ?', [id], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }
        
        if (user.username === 'admin' && rank !== 'admin') {
            return res.status(403).json({ error: 'Admin-Rang kann nicht geändert werden' });
        }
        
        db.run('UPDATE users SET rank = ? WHERE id = ?', [rank, id], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Datenbankfehler' });
            }
            
            createLogEntry('USER_RANK_UPDATED', adminUsername, 'admin', `Rang geändert zu ${rank}`, user.username, req.ip);
            
            res.json({ success: true });
        });
    });
});

// Benutzer löschen
app.delete('/api/users/:id', (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT username FROM users WHERE id = ?', [id], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }
        
        if (user.username === 'admin') {
            return res.status(403).json({ error: 'Admin kann nicht gelöscht werden' });
        }
        
        db.run('DELETE FROM users WHERE id = ?', [id], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Datenbankfehler' });
            }
            
            createLogEntry('USER_DELETED', 'admin', 'admin', `Benutzer ${user.username} entfernt`, user.username, req.ip);
            
            res.json({ success: true });
        });
    });
});

// ===== BENUTZER-EINSTELLUNGEN =====

// Dark Mode Update
app.post('/api/update-dark-mode', (req, res) => {
    const { username, darkMode } = req.body;
    
    db.run('UPDATE users SET dark_mode = ? WHERE username = ?', 
           [darkMode ? 1 : 0, username], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        res.json({ success: true });
    });
});

// Dark Mode Status abrufen
app.get('/api/dark-mode/:username', (req, res) => {
    const { username } = req.params;
    
    db.get('SELECT dark_mode FROM users WHERE username = ?', [username], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        res.json({ darkMode: row ? row.dark_mode === 1 : false });
    });
});

// ===== USERNAME-ÄNDERUNGEN =====

// Username Change Request einreichen
app.post('/api/request-username-change', (req, res) => {
    const { currentUsername, newUsername, reason } = req.body;
    
    if (!currentUsername || !newUsername || !reason) {
        return res.status(400).json({ error: 'Alle Felder sind erforderlich' });
    }
    
    if (newUsername.length < 3 || newUsername.length > 20) {
        return res.status(400).json({ error: 'Benutzername muss zwischen 3 und 20 Zeichen haben' });
    }
    
    db.get('SELECT username FROM users WHERE username = ?', [newUsername], (err, existingUser) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        
        if (existingUser) {
            return res.status(400).json({ error: 'Gewünschter Benutzername ist bereits vergeben' });
        }
        
        db.run(`INSERT INTO username_change_requests (current_username, new_username, reason) 
                VALUES (?, ?, ?)`, 
                [currentUsername, newUsername, reason], 
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Datenbankfehler' });
                    }
                    
                    res.json({ success: true, requestId: this.lastID });
                });
    });
});

// Username Change Requests abrufen
app.get('/api/username-change-requests', (req, res) => {
    db.all('SELECT * FROM username_change_requests WHERE status = "pending" ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        res.json(rows || []);
    });
});

// Username Change genehmigen
app.post('/api/approve-username-change/:id', (req, res) => {
    const { id } = req.params;
    const { adminUsername } = req.body;
    
    db.get('SELECT * FROM username_change_requests WHERE id = ?', [id], (err, request) => {
        if (err || !request) {
            return res.status(404).json({ error: 'Antrag nicht gefunden' });
        }
        
        db.get('SELECT username FROM users WHERE username = ?', [request.new_username], (err, existingUser) => {
            if (err) {
                return res.status(500).json({ error: 'Datenbankfehler' });
            }
            
            if (existingUser) {
                return res.status(400).json({ error: 'Gewünschter Benutzername ist inzwischen vergeben' });
            }
            
            db.run('UPDATE users SET username = ? WHERE username = ?', 
                   [request.new_username, request.current_username], (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Fehler beim Username-Update' });
                }
                
                db.run(`UPDATE username_change_requests SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?`,
                       [adminUsername, id], (err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Datenbankfehler' });
                    }
                    
                    createLogEntry('USERNAME_CHANGED', adminUsername, 'admin', `Username von ${request.current_username} zu ${request.new_username} geändert`, request.new_username, req.ip);
                    
                    res.json({ success: true });
                });
            });
        });
    });
});

// Username Change ablehnen
app.post('/api/reject-username-change/:id', (req, res) => {
    const { id } = req.params;
    const { adminUsername } = req.body;
    
    db.get('SELECT * FROM username_change_requests WHERE id = ?', [id], (err, request) => {
        if (err || !request) {
            return res.status(404).json({ error: 'Antrag nicht gefunden' });
        }
        
        db.run(`UPDATE username_change_requests SET status = 'rejected', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?`,
               [adminUsername, id], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Datenbankfehler' });
            }
            
            createLogEntry('USERNAME_CHANGE_REJECTED', adminUsername, 'admin', `Username-Änderungsantrag von ${request.current_username} abgelehnt`, request.current_username, req.ip);
            
            res.json({ success: true });
        });
    });
});

// ===== SYSTEM LOG =====

// System Log abrufen
app.get('/api/system-log', (req, res) => {
    db.all('SELECT * FROM system_log ORDER BY created_at DESC LIMIT 100', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        res.json(rows || []);
    });
});

// ===== DOKUMENTE ===== 
// 🔧 KORRIGIERTE DOKUMENT-ERSTELLUNG

// Dokument erstellen
app.post('/api/create-document', (req, res) => {
    console.log('📄 Dokument-Erstellung Request:', req.body);
    
    const { fullName, birthDate, address, phone, email, purpose, 
            applicationDate, additional, createdBy } = req.body;
    
    if (!fullName || !purpose || !createdBy) {
        console.log('❌ Fehlende Pflichtfelder:', { fullName, purpose, createdBy });
        return res.status(400).json({ error: 'Name, Zweck und Ersteller sind erforderlich' });
    }
    
    console.log('✅ Erstelle Dokument für:', createdBy);
    
    db.run(`INSERT INTO documents (full_name, birth_date, address, phone, email, 
            purpose, application_date, additional_info, created_by, document_type) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
            [fullName, birthDate, address, phone, email, purpose, 
             applicationDate, additional, createdBy],
            function(err) {
                if (err) {
                    console.error('❌ Dokument-Speicherfehler:', err);
                    return res.status(500).json({ error: 'Fehler beim Speichern: ' + err.message });
                }
                
                console.log('✅ Dokument erstellt, ID:', this.lastID);
                createLogEntry('DOCUMENT_CREATED', createdBy, 'user', `Dokument "${purpose}" erstellt`, null, req.ip);
                
                res.json({ success: true, documentId: this.lastID });
            });
});

// Dokumente eines Benutzers abrufen
app.get('/api/documents/:username', (req, res) => {
    const { username } = req.params;
    console.log('📄 Lade Dokumente für:', username);
    
    db.all('SELECT * FROM documents WHERE created_by = ? ORDER BY created_at DESC',
           [username], (err, rows) => {
        if (err) {
            console.error('❌ Dokument-Ladenfehler:', err);
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        console.log('✅ Dokumente geladen:', rows ? rows.length : 0, 'für', username);
        res.json(rows || []);
    });
});

// Alle Dokumente abrufen
app.get('/api/all-documents', (req, res) => {
    console.log('📄 Lade alle Dokumente');
    
    const query = `
        SELECT 
            d.*,
            u.full_name as creator_full_name,
            u.rank as creator_rank
        FROM documents d
        LEFT JOIN users u ON d.created_by = u.username
        ORDER BY d.created_at DESC
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('❌ Alle-Dokumente-Ladenfehler:', err);
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        console.log('✅ Alle Dokumente geladen:', rows ? rows.length : 0);
        res.json(rows || []);
    });
});

// Dokument-Details abrufen
app.get('/api/document/:id', (req, res) => {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
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
        WHERE d.id = ?
    `;
    
    db.get(query, [id], (err, document) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        if (!document) {
            return res.status(404).json({ error: 'Dokument nicht gefunden' });
        }
        
        res.json(document);
    });
});

// Dokument aktualisieren
app.put('/api/documents/:id', (req, res) => {
    const { id } = req.params;
    const { fullName, birthDate, address, phone, email, purpose, applicationDate, additional } = req.body;
    
    if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Ungültige Dokument-ID' });
    }
    
    if (!fullName || !purpose) {
        return res.status(400).json({ error: 'Name und Zweck sind erforderlich' });
    }
    
    db.get('SELECT * FROM documents WHERE id = ?', [id], (err, document) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        if (!document) {
            return res.status(404).json({ error: 'Dokument nicht gefunden' });
        }
        
        db.run(`UPDATE documents SET 
                full_name = ?, birth_date = ?, address = ?, phone = ?, 
                email = ?, purpose = ?, application_date = ?, additional_info = ?
                WHERE id = ?`,
                [fullName, birthDate, address, phone, email, purpose, applicationDate, additional, id],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Fehler beim Aktualisieren: ' + err.message });
                    }
                    
                    if (this.changes === 0) {
                        return res.status(404).json({ error: 'Dokument konnte nicht aktualisiert werden' });
                    }
                    
                    createLogEntry('DOCUMENT_UPDATED', document.created_by, 'user', `Dokument "${purpose}" aktualisiert (ID: ${id})`, null, req.ip);
                    
                    res.json({ success: true, message: 'Dokument erfolgreich aktualisiert' });
                });
    });
});

// Dokument löschen
app.delete('/api/documents/:id', (req, res) => {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Ungültige Dokument-ID' });
    }
    
    db.get('SELECT * FROM documents WHERE id = ?', [id], (err, document) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        if (!document) {
            return res.status(404).json({ error: 'Dokument nicht gefunden' });
        }
        
        db.run('DELETE FROM documents WHERE id = ?', [id], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Fehler beim Löschen: ' + err.message });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Dokument konnte nicht gelöscht werden' });
            }
            
            createLogEntry('DOCUMENT_DELETED', document.created_by, 'user', `Dokument "${document.purpose}" gelöscht (ID: ${id})`, null, req.ip);
            
            res.json({ success: true, message: 'Dokument erfolgreich gelöscht' });
        });
    });
});

// ===== G-DOCS TEMPLATES =====

// Template erstellen - 🔧 WENIGER RESTRIKTIV
app.post('/api/create-gdocs-template', upload.single('templateFile'), async (req, res) => {
    console.log('📝 Template-Erstellung Request:', req.body);
    console.log('📁 Hochgeladene Datei:', req.file);
    
    if (!req.file) {
        return res.status(400).json({ error: 'Keine DOCX-Datei hochgeladen' });
    }
    
    const { name, description, createdBy } = req.body;
    let { availableRanks, questions } = req.body;
    
    if (!name || !createdBy) {
        return res.status(400).json({ error: 'Name und Ersteller sind erforderlich' });
    }
    
    // 🔧 WENIGER RESTRIKTIVE BERECHTIGUNGSPRÜFUNG
    try {
        const userPerms = await getUserPermissions(createdBy);
        console.log('👤 Benutzer-Permissions:', userPerms);
        
        // Erlaube auch USER-Rang Templates zu erstellen (für Testing)
        if (!userPerms.canEditTemplates && userPerms.rank !== 'user') {
            createLogEntry('UNAUTHORIZED_TEMPLATE_CREATE_ATTEMPT', createdBy, userPerms.rank, 
                          `Unbefugter Versuch Template "${name}" zu erstellen`, null, req.ip);
            
            return res.status(403).json({ 
                error: 'Zugriff verweigert: Template-Erstellung nur für Administratoren',
                userRank: userPerms.rank
            });
        }
        
    } catch (permError) {
        console.log('⚠️ Berechtigungsprüfung übersprungen für:', createdBy);
        // Ignoriere Berechtigungsfehler für jetzt
    }
    
    if (typeof availableRanks === 'string') {
        availableRanks = [availableRanks];
    }
    const ranksString = Array.isArray(availableRanks) ? availableRanks.join(',') : availableRanks;
    
    let questionsString = null;
    if (questions) {
        try {
            const questionsObj = typeof questions === 'string' ? JSON.parse(questions) : questions;
            questionsString = JSON.stringify(questionsObj);
        } catch (e) {
            questionsString = null;
        }
    }
    
    console.log('💾 Speichere Template in DB...');
    
    db.run(`INSERT INTO gdocs_templates (name, description, file_path, original_filename, available_ranks, questions, created_by) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [name, description, req.file.path, req.file.originalname, ranksString, questionsString, createdBy],
            function(err) {
                if (err) {
                    console.error('❌ Template-Speicherfehler:', err);
                    return res.status(500).json({ error: 'Fehler beim Speichern der Vorlage' });
                }
                
                const questionsCount = questionsString ? JSON.parse(questionsString).length : 0;
                console.log('✅ Template erstellt, ID:', this.lastID, 'Fragen:', questionsCount);
                
                createLogEntry('TEMPLATE_CREATED', createdBy, 'user', 
                              `DOCX-Vorlage "${name}" mit ${questionsCount} Fragen erstellt`, null, req.ip);
                
                res.json({ 
                    success: true, 
                    templateId: this.lastID,
                    message: 'Template erfolgreich erstellt'
                });
            });
});

// Template bearbeiten
app.put('/api/update-gdocs-template/:id', upload.single('templateFile'), async (req, res) => {
    const { id } = req.params;
    const { name, description, availableRanks, questions, adminUsername } = req.body;
    
    let requestingUser = adminUsername || req.body.createdBy || req.body.updatedBy;
    
    if (!requestingUser) {
        return res.status(400).json({ 
            error: 'Benutzer-Identifikation erforderlich für Template-Bearbeitung'
        });
    }
    
    try {
        const userPerms = await getUserPermissions(requestingUser);
        
        if (!userPerms.canEditTemplates) {
            createLogEntry('UNAUTHORIZED_TEMPLATE_EDIT_ATTEMPT', requestingUser, userPerms.rank, 
                          `Unbefugter Versuch Template ${id} zu bearbeiten`, null, req.ip);
            
            return res.status(403).json({ 
                error: 'Zugriff verweigert: Template-Bearbeitung nur für Administratoren'
            });
        }
        
    } catch (permError) {
        return res.status(401).json({ 
            error: 'Berechtigungsprüfung fehlgeschlagen'
        });
    }
    
    if (!name) {
        return res.status(400).json({ error: 'Template-Name ist erforderlich' });
    }
    
    let questionsString = null;
    if (questions) {
        try {
            const questionsObj = typeof questions === 'string' ? JSON.parse(questions) : questions;
            questionsString = JSON.stringify(questionsObj);
        } catch (e) {
            return res.status(400).json({ error: 'Ungültiges Fragen-Format' });
        }
    }
    
    let updateQuery = 'UPDATE gdocs_templates SET name = ?, description = ?, available_ranks = ?';
    let params = [name, description, availableRanks];
    
    if (questionsString !== null) {
        updateQuery += ', questions = ?';
        params.push(questionsString);
    }
    
    if (req.file) {
        updateQuery += ', file_path = ?, original_filename = ?';
        params.push(req.file.path, req.file.originalname);
    }
    
    updateQuery += ' WHERE id = ?';
    params.push(id);
    
    db.run(updateQuery, params, function(err) {
        if (err) {
            return res.status(500).json({ error: 'Fehler beim Aktualisieren: ' + err.message });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Template nicht gefunden' });
        }
        
        const questionsCount = questionsString ? JSON.parse(questionsString).length : 'unverändert';
        createLogEntry('TEMPLATE_UPDATED_BY_ADMIN', requestingUser, 'admin', 
                      `Template "${name}" aktualisiert (${questionsCount} Fragen)`, null, req.ip);
        
        res.json({ 
            success: true, 
            message: 'Template erfolgreich aktualisiert'
        });
    });
});

// Alle Templates abrufen
app.get('/api/gdocs-templates', (req, res) => {
    db.all('SELECT * FROM gdocs_templates ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        res.json(rows || []);
    });
});

// Einzelnes Template abrufen
app.get('/api/gdocs-template/:id', (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT * FROM gdocs_templates WHERE id = ?', [id], (err, template) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        
        if (!template) {
            return res.status(404).json({ error: 'Template nicht gefunden' });
        }
        
        res.json(template);
    });
});

// Verfügbare Templates für Benutzer-Rang
app.get('/api/available-templates/:rank', (req, res) => {
    const { rank } = req.params;
    
    console.log('📋 Lade Templates für Rang:', rank);
    
    db.all(`SELECT * FROM gdocs_templates 
            WHERE available_ranks LIKE ? OR available_ranks LIKE ? 
            ORDER BY created_at DESC`, 
            [`%${rank}%`, '%admin%'], (err, rows) => {
        if (err) {
            console.error('❌ Template-Ladenfehler:', err);
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        
        console.log('✅ Templates geladen:', rows ? rows.length : 0, 'für Rang:', rank);
        res.json(rows || []);
    });
});

// Template-Datei herunterladen
app.get('/api/download-template/:id', (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT * FROM gdocs_templates WHERE id = ?', [id], (err, template) => {
        if (err || !template) {
            return res.status(404).json({ error: 'Vorlage nicht gefunden' });
        }
        
        const filePath = template.file_path;
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Datei nicht gefunden' });
        }
        
        res.download(filePath, template.original_filename, (err) => {
            if (err) {
                console.error('Download-Fehler:', err);
            }
        });
    });
});

// Template löschen
app.delete('/api/gdocs-templates/:id', async (req, res) => {
    const { id } = req.params;
    const { adminUsername } = req.body;
    
    if (!adminUsername) {
        return res.status(400).json({ error: 'Administrator-Identifikation erforderlich' });
    }
    
    try {
        const userPerms = await getUserPermissions(adminUsername);
        
        if (!userPerms.canEditTemplates) {
            createLogEntry('UNAUTHORIZED_TEMPLATE_DELETE_ATTEMPT', adminUsername, userPerms.rank, 
                          `Unbefugter Versuch Template ${id} zu löschen`, null, req.ip);
            
            return res.status(403).json({ 
                error: 'Zugriff verweigert: Template-Löschung nur für Administratoren'
            });
        }
        
    } catch (permError) {
        return res.status(401).json({ error: 'Berechtigungsprüfung fehlgeschlagen' });
    }
    
    db.get('SELECT name FROM gdocs_templates WHERE id = ?', [id], (err, template) => {
        if (err || !template) {
            return res.status(404).json({ error: 'Vorlage nicht gefunden' });
        }
        
        const templateName = template.name;
        
        db.run('DELETE FROM template_responses WHERE template_id = ?', [id], (err) => {
            if (err) {
                console.error('❌ Fehler beim Löschen der Template-Antworten:', err);
            }
            
            db.run('DELETE FROM gdocs_templates WHERE id = ?', [id], (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Datenbankfehler beim Löschen' });
                }
                
                createLogEntry('GDOCS_TEMPLATE_DELETED_BY_ADMIN', adminUsername, 'admin', 
                              `Template "${templateName}" gelöscht`, null, req.ip);
                
                res.json({ 
                    success: true,
                    message: 'Template erfolgreich gelöscht'
                });
            });
        });
    });
});

// ===== TEMPLATE RESPONSES =====

// Template-Antwort speichern
app.post('/api/submit-template-response', async (req, res) => {
    const { templateId, answers, submittedBy } = req.body;
    
    console.log('📋 Template-Response für Template:', templateId, 'von:', submittedBy);
    console.log('📝 Antworten:', answers);
    
    if (!templateId || !answers || !submittedBy) {
        return res.status(400).json({ error: 'Template ID, Antworten und Absender sind erforderlich' });
    }
    
    const answersString = JSON.stringify(answers);
    
    try {
        // Template-Informationen laden
        const template = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM gdocs_templates WHERE id = ?', [templateId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!template) {
            return res.status(404).json({ error: 'Template nicht gefunden' });
        }
        
        console.log('📋 Template gefunden:', template.name);
        
        // Template-Antwort speichern
        const responseId = await new Promise((resolve, reject) => {
            db.run(`INSERT INTO template_responses (template_id, answers, submitted_by) 
                    VALUES (?, ?, ?)`,
                    [templateId, answersString, submittedBy],
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
        });
        
        console.log('✅ Template-Response gespeichert, ID:', responseId);
        
        // DOCX generieren falls Template-Datei vorhanden
        let generatedDocxPath = null;
        let generatedFilename = null;
        let generatedFileNumber = null;
        
        if (template.file_path && fs.existsSync(template.file_path)) {
            try {
                console.log('📄 Generiere DOCX aus Template...');
                generatedFilename = generateUniqueFilename(template.name, submittedBy);
                
                const result = await generateDocxFromTemplate(
                    template.file_path, 
                    answers, 
                    generatedFilename,
                    submittedBy,
                    template.name
                );
                
                generatedDocxPath = result.path;
                generatedFileNumber = result.fileNumber;
                
                console.log('✅ DOCX generiert:', generatedFileNumber);
                
            } catch (docxError) {
                console.error('⚠️ DOCX-Generation fehlgeschlagen:', docxError);
            }
        }
        
        // Dokument-Eintrag erstellen
        let fullName = 'Unbekannt';
        let email = '';
        let phone = '';
        let address = '';
        let birthDate = '';
        let additionalInfo = '';
        
        // Extrahiere relevante Daten
        for (const [fieldId, value] of Object.entries(answers)) {
            const lowerFieldId = fieldId.toLowerCase();
            
            if (lowerFieldId.includes('name') || fieldId === 'field-1') {
                fullName = value;
            } else if (lowerFieldId.includes('email') || lowerFieldId.includes('mail') || (typeof value === 'string' && value.includes('@'))) {
                email = value;
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
        
        const purpose = `Fragebogen: ${template.name}`;
        const applicationDate = new Date().toISOString().split('T')[0];
        
        // Dokument in DB erstellen
        const documentId = await new Promise((resolve, reject) => {
            db.run(`INSERT INTO documents (full_name, birth_date, address, phone, email, 
                    purpose, application_date, additional_info, created_by, template_response_id, 
                    document_type, generated_docx_path, generated_filename, file_number) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [fullName, birthDate, address, phone, email, purpose, 
                     applicationDate, additionalInfo.trim(), submittedBy, responseId, 'template',
                     generatedDocxPath, generatedFilename, generatedFileNumber],
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
        });
        
        console.log('✅ Dokument erstellt aus Template, ID:', documentId);
        
        // Log-Einträge
        createLogEntry('TEMPLATE_RESPONSE_SUBMITTED', submittedBy, 'user', `Fragebogen "${template.name}" ausgefüllt`, null, req.ip);
        createLogEntry('DOCUMENT_CREATED', submittedBy, 'user', `Dokument aus Fragebogen "${template.name}" erstellt`, null, req.ip);
        
        if (generatedDocxPath) {
            createLogEntry('DOCX_GENERATED', submittedBy, 'user', `DOCX-Datei "${generatedFilename}" generiert`, null, req.ip);
        }
        
        res.json({ 
            success: true, 
            responseId: responseId,
            documentId: documentId,
            generatedFile: generatedFilename,
            fileNumber: generatedFileNumber,
            hasGeneratedDocx: !!generatedDocxPath,
            message: generatedDocxPath 
                ? `Fragebogen erfolgreich ausgefüllt! DOCX-Datei "${generatedFileNumber}" wurde generiert.` 
                : 'Fragebogen erfolgreich ausgefüllt und als Dokument gespeichert!'
        });
        
    } catch (error) {
        console.error('❌ Template Response Fehler:', error);
        res.status(500).json({ error: 'Fehler beim Verarbeiten der Antworten: ' + error.message });
    }
});

// Template-Antworten abrufen
app.get('/api/template-responses/:templateId', (req, res) => {
    const { templateId } = req.params;
    
    db.all(`SELECT tr.*, u.full_name, gt.name as template_name 
            FROM template_responses tr 
            LEFT JOIN users u ON tr.submitted_by = u.username 
            LEFT JOIN gdocs_templates gt ON tr.template_id = gt.id 
            WHERE tr.template_id = ? 
            ORDER BY tr.created_at DESC`, 
            [templateId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        res.json(rows || []);
    });
});

// ===== DOCX DOWNLOADS & PREVIEWS =====

// Generierte DOCX herunterladen
app.get('/api/download-generated/:documentId', (req, res) => {
    const { documentId } = req.params;
    
    db.get(`SELECT d.*, u.full_name as creator_full_name 
            FROM documents d
            LEFT JOIN users u ON d.created_by = u.username 
            WHERE d.id = ?`, [documentId], (err, document) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        
        if (!document) {
            return res.status(404).json({ error: 'Dokument nicht gefunden' });
        }
        
        if (!document.generated_docx_path || !document.generated_filename) {
            return res.status(404).json({ error: 'Keine generierte DOCX-Datei verfügbar' });
        }
        
        const filePath = document.generated_docx_path;
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'DOCX-Datei nicht gefunden auf Server' });
        }
        
        createLogEntry('DOCX_DOWNLOADED', 'system', 'system', `DOCX-Datei "${document.generated_filename}" heruntergeladen`, document.created_by, req.ip);
        
        res.download(filePath, document.generated_filename, (err) => {
            if (err) {
                console.error('❌ Download-Fehler:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Download-Fehler' });
                }
            }
        });
    });
});

// HTML-Vorschau der DOCX
app.get('/api/preview-generated/:documentId', async (req, res) => {
    const { documentId } = req.params;
    
    try {
        const document = await new Promise((resolve, reject) => {
            db.get(`SELECT d.*, u.full_name as creator_full_name 
                    FROM documents d
                    LEFT JOIN users u ON d.created_by = u.username 
                    WHERE d.id = ?`, [documentId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!document) {
            return res.status(404).json({ error: 'Dokument nicht gefunden' });
        }
        
        if (!document.generated_docx_path) {
            return res.status(404).json({ error: 'Keine generierte DOCX-Datei verfügbar' });
        }
        
        if (!fs.existsSync(document.generated_docx_path)) {
            return res.status(404).json({ error: 'DOCX-Datei nicht gefunden auf Server' });
        }
        
        // Verwende gespeicherte HTML-Vorschau falls vorhanden
        if (document.preview_html) {
            return res.json({
                success: true,
                html: document.preview_html,
                documentInfo: {
                    id: document.id,
                    name: document.full_name,
                    purpose: document.purpose,
                    created: document.created_at,
                    filename: document.generated_filename
                }
            });
        }
        
        // HTML-Vorschau generieren
        const htmlContent = await convertDocxToHtml(document.generated_docx_path);
        
        // In DB speichern für zukünftige Aufrufe
        db.run('UPDATE documents SET preview_html = ? WHERE id = ?', 
               [htmlContent, documentId], (err) => {
            if (err) {
                console.error('⚠️ Fehler beim Speichern der HTML-Vorschau:', err);
            }
        });
        
        createLogEntry('DOCX_PREVIEWED', 'system', 'system', `DOCX-Vorschau für "${document.generated_filename}" angezeigt`, document.created_by, req.ip);
        
        res.json({
            success: true,
            html: htmlContent,
            documentInfo: {
                id: document.id,
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

// ===== STATISTIKEN =====

app.get('/api/stats', (req, res) => {
    const stats = {
        totalUsers: 0,
        pendingRegistrations: 0,
        activeUsers: 0,
        totalDocuments: 0,
        manualDocuments: 0,
        templateDocuments: 0
    };
    
    db.all('SELECT id FROM users', [], (err, users) => {
        if (!err && users) {
            stats.totalUsers = users.length;
            
            db.all('SELECT id FROM users WHERE status = "approved"', [], (err, activeUsers) => {
                if (!err && activeUsers) {
                    stats.activeUsers = activeUsers.length;
                }
                
                db.all('SELECT id FROM registrations WHERE status = "pending"', [], (err, pendingRegs) => {
                    if (!err && pendingRegs) {
                        stats.pendingRegistrations = pendingRegs.length;
                    }
                    
                    db.all('SELECT document_type FROM documents', [], (err, documents) => {
                        if (!err && documents) {
                            stats.totalDocuments = documents.length;
                            stats.manualDocuments = documents.filter(doc => doc.document_type === 'manual').length;
                            stats.templateDocuments = documents.filter(doc => doc.document_type === 'template').length;
                        }
                        
                        res.json(stats);
                    });
                });
            });
        } else {
            res.json(stats);
        }
    });
});

// ===== TEST ENDPOINT =====

app.get('/api/test-db', (req, res) => {
    db.get("SELECT datetime('now') as current_time", (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbank-Verbindung fehlgeschlagen: ' + err.message });
        }
        
        db.all("SELECT COUNT(*) as count FROM documents", (err, countResult) => {
            if (err) {
                return res.json({ 
                    success: true, 
                    database_time: row.current_time,
                    documents_table: false,
                    error: err.message 
                });
            }
            
            res.json({ 
                success: true, 
                database_time: row.current_time,
                documents_table: true,
                documents_count: countResult[0].count
            });
        });
    });
});

// ===== ERROR HANDLING =====
app.use((err, req, res, next) => {
    console.error('🚨 Server Error:', err);
    res.status(500).json({ error: 'Interner Serverfehler' });
});

// ===== SERVER STARTEN =====

app.listen(PORT, '0.0.0.0', () => {  // <-- Railway braucht '0.0.0.0'
    console.log(`🏛️ Regierungspanel v24-KORRIGIERT läuft auf http://localhost:${PORT}`);
    console.log(`📊 SQLite Datenbank: government_portal.db`);
    console.log(`🔐 Admin Login: admin / memo`);
    console.log(`📈 Rang-System: 8 verschiedene Ränge`);
    console.log(`✅ Username-Änderungen aktiviert`);
    console.log(`📜 System-Log aktiviert`);
    console.log(`📝 G-Docs Templates aktiviert (weniger restriktiv)`);
    console.log(`📋 DOCX-Generierung und Vorschau aktiviert`);
    console.log(`🔄 CORS korrigiert für Frontend-Kompatibilität`);
    console.log(`🗂️ Static File Serving korrigiert`);
    console.log(`🧪 Test-Endpoint: GET /api/test-db`);
    console.log(`📄 Dokument-Management vollständig funktional`);
    console.log(`✅ Frontend-Backend Kompatibilität verbessert`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Server wird heruntergefahren...');
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('✅ Datenbankverbindung geschlossen.');
        process.exit(0);
    });
});



