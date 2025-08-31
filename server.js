// ssserver.js v23 - FIXES: Dokument-Löschung + Fragebogen als Dokumente
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');


// ✅ PERSISTENTE UPLOAD-VERZEICHNISSE
const uploadsBasePath = process.env.NODE_ENV === 'production' 
    ? '/app/data/uploads'
    : 'uploads';

// Multer-Konfiguration für DOCX-Upload - GEÄNDERT
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(uploadsBasePath, 'templates/');
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

// Neue Ims für DOCX-Processing
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const mammoth = require('mammoth');

 // Generierte Dateien Verzeichnis - GEÄNDERT
const generatedDir = path.join(uploadsBasePath, 'generated/');
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

// PostgreSQL Connection Pool
// PostgreSQL Connection Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { 
    rejectUnauthorized: false 
  } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// DEBUG: Umgebungsvariablen prüfen
console.log('🔍 DEBUG: DATABASE_URL exists:', !!process.env.DATABASE_URL);
if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL ist nicht gesetzt!');
    process.exit(1);
}

console.log('🗃️ PostgreSQL-Verbindung initialisiert');

// SQLite-kompatible Wrapper (KORRIGIERT)
// SQLite-kompatible Wrapper (KORRIGIERT)
const db = {
  run: (query, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    
    pool.query(query, params, (err, result) => {
      if (callback) {
        if (err) {
          callback(err);
        } else {
          const context = {
            lastID: result.rows && result.rows[0] && result.rows[0].id ? result.rows[0].id : null,
            changes: result.rowCount || 0
          };
          callback.call(context, null);  // <- DAS FEHLT!
        }                               // <- DAS FEHLT!
      }                                 // <- DAS FEHLT!
    });                                 // <- DAS FEHLT!
  },                                    // <- DAS FEHLT!

  get: (query, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    
    pool.query(query, params, (err, result) => {
      if (callback) {
        if (err) {
          callback(err);
        } else {
          callback(null, result.rows[0] || null);
        }
      }
    });
  },

  all: (query, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    
    pool.query(query, params, (err, result) => {
      if (callback) {
        if (err) {
          callback(err);
        } else {
          callback(null, result.rows || []);
        }
      }
    });
  },

  serialize: (callback) => {
    if (callback) callback();
  },

  close: (callback) => {
    pool.end(callback);
  }
};

async function initializeDatabase() {
    console.log('🗃️ Initialisiere PostgreSQL Datenbank...');
    
    try {
        // 1. Users Tabelle
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                rank TEXT DEFAULT 'user',
                role TEXT DEFAULT 'user',
                status TEXT DEFAULT 'approved',
                dark_mode INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                approved_by TEXT,
                approved_at TIMESTAMP
            )
        `);
        
        // 2. Registrations Tabelle
        await pool.query(`
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
            )
        `);
        console.log('✅ Registrations Tabelle erstellt/überprüft');

        // 3. Documents Tabelle
        await pool.query(`
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Documents Tabelle erstellt/überprüft');

        // 4. System Log Tabelle
        await pool.query(`
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
            )
        `);
        console.log('✅ System Log Tabelle erstellt/überprüft');

        // 5. Username Change Requests Tabelle
        await pool.query(`
            CREATE TABLE IF NOT EXISTS username_change_requests (
                id SERIAL PRIMARY KEY,
                current_username TEXT NOT NULL,
                new_username TEXT NOT NULL,
                reason TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                approved_by TEXT,
                approved_at TIMESTAMP
            )
        `);
        console.log('✅ Username Change Requests Tabelle erstellt/überprüft');

        // 6. G-Docs Templates Tabelle
        await pool.query(`
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
            )
        `);
        console.log('✅ G-Docs Templates Tabelle erstellt/überprüft');

        // 7. Template Responses Tabelle
        await pool.query(`
            CREATE TABLE IF NOT EXISTS template_responses (
                id SERIAL PRIMARY KEY,
                template_id INTEGER NOT NULL,
                answers TEXT NOT NULL,
                submitted_by TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Template Responses Tabelle erstellt/überprüft');

        // 8. File Counters Tabelle
        await pool.query(`
            CREATE TABLE IF NOT EXISTS file_counters (
                id SERIAL PRIMARY KEY,
                prefix TEXT NOT NULL UNIQUE,
                current_number INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ File Counters Tabelle erstellt/überprüft');

        // 10. File Counter initialisieren
        await pool.query(`
            INSERT INTO file_counters (prefix, current_number) 
            VALUES ('B', 0) 
            ON CONFLICT (prefix) DO NOTHING`
        );
        console.log('✅ File Counter initialisiert/überprüft');
        
        // Admin User erstellen
        const adminPassword = bcrypt.hashSync('memo', 10);
        await pool.query(`
            INSERT INTO users (username, password_hash, full_name, rank, role, status) 
            VALUES ($1, $2, $3, $4, $5, $6) 
            ON CONFLICT (username) DO NOTHING`,
            ['admin', adminPassword, 'Systemadministrator', 'admin', 'admin', 'approved']
        );
        
        console.log('🎉 Datenbank-Initialisierung erfolgreich!');
        return true;
    } catch (error) {
        console.error('❌ Fehler bei Datenbank-Initialisierung:', error);
        return false;
    }
}

// Log-Eintrag erstellen (Hilfsfunktion)
function createLogEntry(action, performedBy, userRank, details, targetUser = null, ipAddress = null) {
    db.run(`INSERT INTO system_log (action, performed_by, user_rank, details, target_user, ip_address) 
            VALUES ($1, $2, $3, $4, $5, $6)`,
            [action, performedBy, userRank, details, targetUser, ipAddress], (err) => {
                if (err) console.error('Log Fehler:', err);
            });
}
// Vereinfachte Funktion: Nächste B-Nummer generieren
async function getNextFileNumber() {
    return new Promise((resolve, reject) => {
        console.log('📊 Generiere nächste B-Nummer (Bewertung)...');
        
        // Hole aktuellen B-Counter und erhöhe um 1
        db.get('SELECT current_number FROM file_counters WHERE prefix = $1', ['B'], (err, row) => {
            if (err) {
                console.error('❌ Fehler beim Laden des B-Counters:', err);
                return reject(err);
            }
            
             const currentNumber = row ? row.current_number : 0;
             const nextNumber = currentNumber + 1;
            
            // Update Counter in Datenbank
            db.run('UPDATE file_counters SET current_number = $1, updated_at = CURRENT_TIMESTAMP WHERE prefix = $2', 
       [nextNumber, 'B'], (err) => {
                if (err) {
                    console.error('❌ Fehler beim Update des B-Counters:', err);
                    return reject(err);
                }
                
                // Formatiere Nummer mit führenden Nullen (4-stellig)
                 const formattedNumber = nextNumber.toString().padStart(4, '0');
                 const fileNumber = `#B${formattedNumber}-SOCOM`;
                
                console.log(`✅ Neue B-Nummer generiert: ${fileNumber}`);
                resolve(fileNumber);
            });
        });
    });
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
const userData = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE username = $1', [submittedBy], (err, user) => {
                if (err) reject(err);
                else resolve(user || {});
            });
        });
        
        console.log('👤 Benutzerdaten geladen:', userData.full_name);
        
        // ✅ GENERIERE AUTOMATISCHE B-FILE-NUMMER (vereinfacht)
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

// Hilfsfunktion für Rang-Anzeige (falls nicht vorhanden)
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

// Template-Fragen separat bearbeiten
app.put('/api/update-template-questions/:id', (req, res) => {
    const { id } = req.params;
    const { questions } = req.body;
    
    if (!questions || !Array.isArray(questions)) {
        return res.status(400).json({ error: 'Fragen-Array ist erforderlich' });
    }
    
    if (questions.length === 0) {
        return res.status(400).json({ error: 'Mindestens eine Frage ist erforderlich' });
    }
    
    const questionsString = JSON.stringify(questions);
    
    // Prüfe ob Template existiert
    db.get('SELECT name, created_by FROM gdocs_templates WHERE id = $1', [id], (err, template) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        if (!template) {
            return res.status(404).json({ error: 'Template nicht gefunden' });
        }
        
        // Aktualisiere nur die Fragen
        db.run('UPDATE gdocs_templates SET questions = $1 WHERE id = $2', [questionsString, id], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Fehler beim Aktualisieren der Fragen: ' + err.message });
            }
            
            console.log(`✅ Fragen für Template "${template.name}" aktualisiert (${questions.length} Fragen)`);
            
            createLogEntry('TEMPLATE_QUESTIONS_UPDATED', template.created_by, 'admin', `${questions.length} Fragen für Template "${template.name}" aktualisiert`, null, req.ip);
            
            res.json({ 
                success: true, 
                message: `${questions.length} Fragen erfolgreich aktualisiert`,
                questionsCount: questions.length
            });
        });
    });
});
// Template bearbeiten
app.put('/api/update-gdocs-template/:id', upload.single('templateFile'), (req, res) => {
    const { id } = req.params;
    const { name, description, availableRanks } = req.body;
    
    if (!name) {
        return res.status(400).json({ error: 'Name ist erforderlich' });
    }
    
    let updateQuery = 'UPDATE gdocs_templates SET name = $1, description = $2, available_ranks = $3';
    let params = [name, description, availableRanks];
    
    // Falls neue Datei hochgeladen
    if (req.file) {
        updateQuery += ', file_path = $4, original_filename = $5';
        params.push(req.file.path, req.file.originalname);
    }
    
    updateQuery += ' WHERE id = $6';
    params.push(id);
    
    db.run(updateQuery, params, function(err) {
        if (err) {
            return res.status(500).json({ error: 'Fehler beim Aktualisieren: ' + err.message });
        }
        
        createLogEntry('TEMPLATE_UPDATED', 'admin', 'admin', `Template "${name}" aktualisiert`, null, req.ip);
        
        res.json({ success: true });
    });
});

// Dokument aktualisieren (für Bearbeitung)
app.put('/api/documents/:id', (req, res) => {
    const { id } = req.params;
    const { fullName, birthDate, address, phone, email, purpose, applicationDate, additional } = req.body;
    
    console.log('✏️ /api/documents/:id PUT aufgerufen für ID:', id);
    console.log('📝 Update-Daten:', { fullName, email, purpose });
    
    if (!id || isNaN(id)) {
        console.error('❌ Ungültige Dokument-ID:', id);
        return res.status(400).json({ error: 'Ungültige Dokument-ID' });
    }
    
    // Validierung
    if (!fullName || !purpose) {
        console.error('❌ Validierung fehlgeschlagen');
        return res.status(400).json({ error: 'Name und Zweck sind erforderlich' });
    }
    
    // Prüfe ob Dokument existiert und gehört dem Benutzer
    db.get('SELECT * FROM documents WHERE id = $1', [id], (err, document) => {
        if (err) {
            console.error('❌ Datenbank-Fehler beim Prüfen:', err);
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        if (!document) {
            console.error('❌ Dokument nicht gefunden mit ID:', id);
            return res.status(404).json({ error: 'Dokument nicht gefunden' });
        }
        
        console.log('📄 Zu aktualisierendes Dokument gefunden:', document.purpose);
        
        // Update ausführen
        db.run(`UPDATE documents SET 
        full_name = $1, birth_date = $2, address = $3, phone = $4, 
        purpose = $5, application_date = $6, additional_info = $7
        WHERE id = $8`,
        [fullName, birthDate, address, phone, purpose, applicationDate, additional, id],
                function(err) {
                    if (err) {
                        console.error('❌ Fehler beim Update:', err);
                        return res.status(500).json({ error: 'Fehler beim Aktualisieren: ' + err.message });
                    }
                    
                    if (this.changes === 0) {
                        console.error('❌ Kein Dokument wurde aktualisiert (changes = 0)');
                        return res.status(404).json({ error: 'Dokument konnte nicht aktualisiert werden' });
                    }
                    
                    console.log('✅ Dokument erfolgreich aktualisiert, ID:', id, 'Changes:', this.changes);
                    
                    // Log-Eintrag erstellen
                    createLogEntry('DOCUMENT_UPDATED', document.created_by, 'user', `Dokument "${purpose}" aktualisiert (ID: ${id})`, null, req.ip);
                    
                    res.json({ success: true, message: 'Dokument erfolgreich aktualisiert' });
                });
    });
});


// Erweiterte viewDocumentDetails Funktion
async function viewDocumentDetails(docId) {
    console.log('👁️ Zeige Dokument-Details für ID:', docId);
    
    try {
        const document = await apiCall(`/document/${docId}`);
        console.log('📄 Dokument-Details erhalten:', document);
        
        showDocumentDetailsModal(document);
        
    } catch (error) {
        console.error('❌ Fehler beim Laden der Dokument-Details:', error);
        alert(`Fehler beim Laden der Details: ${error.message}`);
    }
}

// Alle Dokumente abrufen (neue Route)
app.get('/api/all-documents', (req, res) => {
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
    
    // Filter basierend auf Typ anwenden
    if (filterType === 'manual') {
        query += ` WHERE d.document_type = 'manual'`;
        console.log('🔍 Filter: Nur manuelle Dokumente');
    } else if (filterType === 'template' && templateId) {
        query += ` WHERE tr.template_id = $2`;
        queryParams.push(templateId);
        console.log('🔍 Filter: Nur Template ID', templateId);
    } else if (filterType === 'template') {
        query += ` WHERE d.document_type = 'template'`;
        console.log('🔍 Filter: Alle Fragebogen-Dokumente');
    }
    // Wenn filterType === 'all' oder undefined, keine WHERE-Klausel hinzufügen
    
    query += ` ORDER BY d.created_at DESC`;
    
    console.log('📋 SQL Query:', query);
    console.log('📋 Query Params:', queryParams);
    
    db.all(query, queryParams, (err, rows) => {
        if (err) {
            console.error('❌ Datenbank-Fehler beim Laden aller Dokumente:', err);
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        console.log('📊 Alle Dokumente geladen:', rows ? rows.length : 'null');
        if (rows && rows.length > 0) {
            console.log('📋 Erste 3 Dokumente:', rows.slice(0, 3).map(doc => ({
                id: doc.id,
                full_name: doc.full_name,
                created_by: doc.created_by,
                document_type: doc.document_type,
                template_name: doc.template_name
            })));
        }
        
        res.json(rows || []);
    });
});

// Download & Vorschau API Endpoints - Fügen Sie diese in server.js hinzu

// Generierte DOCX-Datei herunterladen
app.get('/api/download-generated/:documentId', (req, res) => {
    const { documentId } = req.params;
    
    console.log('📥 Download-Anfrage für Dokument ID:', documentId);
    
    // Dokument aus DB laden
    db.get(`SELECT d.*, u.full_name as creator_full_name 
            FROM documents d
            LEFT JOIN users u ON d.created_by = u.username 
            WHERE d.id = $1`, [documentId], (err, document) => {
        if (err) {
            console.error('❌ DB-Fehler beim Download:', err);
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        
        if (!document) {
            console.error('❌ Dokument nicht gefunden:', documentId);
            return res.status(404).json({ error: 'Dokument nicht gefunden' });
        }
        
        if (!document.generated_docx_path || !document.generated_filename) {
            console.error('❌ Keine generierte DOCX-Datei für Dokument:', documentId);
            return res.status(404).json({ error: 'Keine generierte DOCX-Datei verfügbar' });
        }
        
        const filePath = document.generated_docx_path;
        
        // Prüfe ob Datei existiert
        if (!fs.existsSync(filePath)) {
            console.error('❌ DOCX-Datei nicht gefunden:', filePath);
            return res.status(404).json({ error: 'DOCX-Datei nicht gefunden auf Server' });
        }
        
        console.log('📄 Sende DOCX-Datei:', filePath);
        
        // Log-Eintrag für Download
        createLogEntry('DOCX_DOWNLOADED', 'system', 'system', `DOCX-Datei "${document.generated_filename}" heruntergeladen`, document.created_by, req.ip);
        
        // Datei senden
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
    });
});

// HTML-Vorschau der generierten DOCX-Datei
app.get('/api/preview-generated/:documentId', async (req, res) => {
    const { documentId } = req.params;
    
    console.log('👁️ Vorschau-Anfrage für Dokument ID:', documentId);
    
    try {
        // Dokument aus DB laden
        const document = await new Promise((resolve, reject) => {
            db.get(`SELECT d.*, u.full_name as creator_full_name 
                    FROM documents d
                    LEFT JOIN users u ON d.created_by = u.username 
                    WHERE d.id = $1`, [documentId], (err, row) => {
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
        
        // Prüfe ob DOCX-Datei existiert
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
        db.run('UPDATE documents SET preview_html = ? WHERE id = $1', 
               [htmlContent, documentId], (err) => {
            if (err) {
                console.error('⚠️ Fehler beim Speichern der HTML-Vorschau:', err);
            } else {
                console.log('✅ HTML-Vorschau in DB gespeichert');
            }
        });
        
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

// Alle generierten Dokumente für einen Benutzer abrufen
app.get('/api/generated-documents/:username', (req, res) => {
    const { username } = req.params;
    
    console.log('📋 Lade generierte Dokumente für:', username);
    
    db.all(`SELECT d.*, u.full_name as creator_full_name 
            FROM documents d
            LEFT JOIN users u ON d.created_by = u.username 
            WHERE d.created_by = $1 AND d.generated_docx_path IS NOT NULL
            ORDER BY d.created_at DESC`,
            [username], (err, rows) => {
        if (err) {
            console.error('❌ DB-Fehler beim Laden generierter Dokumente:', err);
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        console.log('📊 Generierte Dokumente gefunden:', rows ? rows.length : 'null');
        res.json(rows || []);
    });
});

// Alle generierten Dokumente (Admin-View)
app.get('/api/all-generated-documents', (req, res) => {
    console.log('📋 Lade alle generierten Dokumente (Admin)');
    
    db.all(`SELECT d.*, u.full_name as creator_full_name, u.rank as creator_rank
            FROM documents d
            LEFT JOIN users u ON d.created_by = u.username 
            WHERE d.generated_docx_path IS NOT NULL
            ORDER BY d.created_at DESC`,
            [], (err, rows) => {
        if (err) {
            console.error('❌ DB-Fehler beim Laden aller generierten Dokumente:', err);
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        console.log('📊 Alle generierten Dokumente gefunden:', rows ? rows.length : 'null');
        res.json(rows || []);
    });
});

// Database Migration - Fügen Sie das in der db.serialize() Sektion hinzu

// Migration: Füge DOCX-Spalten zur documents Tabelle hinzu
db.all("PRAGMA table_info(documents)", (err, columns) => {
    if (!err && columns) {
        const columnNames = columns.map(col => col.name);
        console.log('📊 Documents Tabellen-Struktur:', columnNames);
        
        // Füge generated_docx_path Spalte hinzu falls fehlend
        if (!columnNames.includes('generated_docx_path')) {
            db.run("ALTER TABLE documents ADD COLUMN generated_docx_path TEXT", (err) => {
                if (!err) {
                    console.log('✅ generated_docx_path Spalte hinzugefügt');
                } else {
                    console.log('ℹ️ generated_docx_path Spalte existiert bereits');
                }
            });
        }

        // Datenbank-Migration für File-Nummer - Fügen Sie in die bestehende Migration hinzu

// In der bestehenden documents Tabellen-Migration, fügen Sie hinzu:
if (!columnNames.includes('file_number')) {
    db.run("ALTER TABLE documents ADD COLUMN file_number TEXT", (err) => {
        if (!err) {
            console.log('✅ file_number Spalte hinzugefügt');
        } else {
            console.log('ℹ️ file_number Spalte existiert bereits');
        }
    });
}
        
        // Füge generated_filename Spalte hinzu falls fehlend
        if (!columnNames.includes('generated_filename')) {
            db.run("ALTER TABLE documents ADD COLUMN generated_filename TEXT", (err) => {
                if (!err) {
                    console.log('✅ generated_filename Spalte hinzugefügt');
                } else {
                    console.log('ℹ️ generated_filename Spalte existiert bereits');
                }
            });
        }
        
        // Füge preview_html Spalte für HTML-Vorschau hinzu falls fehlend
        if (!columnNames.includes('preview_html')) {
            db.run("ALTER TABLE documents ADD COLUMN preview_html TEXT", (err) => {
                if (!err) {
                    console.log('✅ preview_html Spalte hinzugefügt');
                } else {
                    console.log('ℹ️ preview_html Spalte existiert bereits');
                }
            });
        }
    }
});

// Erweiterte Statistiken mit Dokumenten-Anzahl
app.get('/api/stats', (req, res) => {
    const stats = {
        totalUsers: 0,
        pendingRegistrations: 0,
        activeUsers: 0,
        totalDocuments: 0, // Neu hinzugefügt
        manualDocuments: 0, // Neu hinzugefügt  
        templateDocuments: 0 // Neu hinzugefügt
    };
    
    // Benutzer zählen
    db.all('SELECT id FROM users', [], (err, users) => {
        if (!err && users) {
            stats.totalUsers = users.length;
            
            // Aktive Benutzer zählen
            db.all('SELECT id FROM users WHERE status = $1', ['approved'], (err, activeUsers) => {
                if (!err && activeUsers) {
                    stats.activeUsers = activeUsers.length;
                }
                
                // Pending Registrierungen zählen
                db.all('SELECT id FROM registrations WHERE status = $1', ['pending'], (err, pendingRegs) => {
                    if (!err && pendingRegs) {
                        stats.pendingRegistrations = pendingRegs.length;
                    }
                    
                    // Dokumente zählen
                    db.all('SELECT document_type FROM documents', [], (err, documents) => {
                        if (!err && documents) {
                            stats.totalDocuments = documents.length;
                            stats.manualDocuments = documents.filter(doc => doc.document_type === 'manual').length;
                            stats.templateDocuments = documents.filter(doc => doc.document_type === 'template').length;
                        }
                        
                        console.log('📊 Statistiken erstellt:', stats);
                        res.json(stats);
                    });
                });
            });
        } else {
            res.json(stats);
        }
    });
});

// Erweiterte Dokument-Details-Route (für Details-Ansicht)
app.get('/api/document/:id', (req, res) => {
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
            tr.answers as template_answers,
            gt.name as template_name,
            gt.description as template_description
        FROM documents d
        LEFT JOIN users u ON d.created_by = u.username
        LEFT JOIN template_responses tr ON d.template_response_id = tr.id
        LEFT JOIN gdocs_templates gt ON tr.template_id = gt.id
        WHERE d.id = $1
    `;
    
    db.get(query, [id], (err, document) => {
        if (err) {
            console.error('❌ Datenbank-Fehler beim Laden des Dokuments:', err);
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        if (!document) {
            console.error('❌ Dokument nicht gefunden mit ID:', id);
            return res.status(404).json({ error: 'Dokument nicht gefunden' });
        }
        
        console.log('✅ Dokument-Details geladen für ID:', id);
        res.json(document);
    });
});

// Log-Eintrag für Dokument-Ansicht (optional)
app.post('/api/log-document-view', (req, res) => {
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

// Tabellen erstellen und migrieren
// ✅ POSTGRESQL TABELLEN ERSTELLEN
app.get('/api/setup-database', async (req, res) => {
    console.log('🗃️ Erstelle PostgreSQL Tabellen...');
    
    try {
        // 1. Users Tabelle
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                rank TEXT DEFAULT 'user',
                role TEXT DEFAULT 'user',
                status TEXT DEFAULT 'approved',
                dark_mode INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                approved_by TEXT,
                approved_at TIMESTAMP
            )
        `);
        console.log('✅ Users Tabelle erstellt');

        // 2. Registrations Tabelle
        await pool.query(`
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
            )
        `);
        console.log('✅ Registrations Tabelle erstellt');

        // 3. Documents Tabelle
        await pool.query(`
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Documents Tabelle erstellt');

        // 4. System Log Tabelle
        await pool.query(`
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
            )
        `);
        console.log('✅ System Log Tabelle erstellt');

        // 5. Username Change Requests Tabelle
        await pool.query(`
            CREATE TABLE IF NOT EXISTS username_change_requests (
                id SERIAL PRIMARY KEY,
                current_username TEXT NOT NULL,
                new_username TEXT NOT NULL,
                reason TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                approved_by TEXT,
                approved_at TIMESTAMP
            )
        `);
        console.log('✅ Username Change Requests Tabelle erstellt');

        // 6. G-Docs Templates Tabelle
        await pool.query(`
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
            )
        `);
        console.log('✅ G-Docs Templates Tabelle erstellt');

        // 7. Template Responses Tabelle
        await pool.query(`
            CREATE TABLE IF NOT EXISTS template_responses (
                id SERIAL PRIMARY KEY,
                template_id INTEGER NOT NULL,
                answers TEXT NOT NULL,
                submitted_by TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Template Responses Tabelle erstellt');

        // 8. File Counters Tabelle
        await pool.query(`
            CREATE TABLE IF NOT EXISTS file_counters (
                id SERIAL PRIMARY KEY,
                prefix TEXT NOT NULL UNIQUE,
                current_number INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ File Counters Tabelle erstellt');

        // 9. Admin User erstellen
        const adminPassword = bcrypt.hashSync('memo', 10);
        await pool.query(`
            INSERT INTO users (username, password_hash, full_name, rank, role, status) 
            VALUES ($1, $2, $3, $4, $5, $6) 
            ON CONFLICT (username) DO NOTHING`,
            ['admin', adminPassword, 'Systemadministrator', 'admin', 'admin', 'approved']
        );
        console.log('✅ Admin User erstellt');

        // 10. File Counter initialisieren
        await pool.query(`
            INSERT INTO file_counters (prefix, current_number) 
            VALUES ('B', 0) 
            ON CONFLICT (prefix) DO NOTHING`
        );
        console.log('✅ File Counter initialisiert');

        res.json({ 
            success: true, 
            message: 'Alle Tabellen erfolgreich erstellt!',
            tables: [
                'users', 'registrations', 'documents', 'system_log',
                'username_change_requests', 'gdocs_templates', 
                'template_responses', 'file_counters'
            ]
        });

    } catch (error) {
        console.error('❌ Fehler beim Erstellen der Tabellen:', error);
        res.status(500).json({ 
            error: 'Fehler beim Setup: ' + error.message 
        });
    }
});

// NACH der pool-Definition hinzufügen:
// Admin-User für PostgreSQL erstellen
setTimeout(() => {
    const adminPassword = bcrypt.hashSync('memo', 10);
    pool.query("SELECT * FROM users WHERE username = 'admin'", (err, result) => {
        if (!err && result.rows.length === 0) {
            // Admin existiert nicht, erstelle ihn
            pool.query(`INSERT INTO users (username, password_hash, full_name, rank, role, status) 
                       VALUES ($1, $2, $3, $4, $5, $6)`, 
                       ['admin', adminPassword, 'Systemadministrator', 'admin', 'admin', 'approved'], 
                       (err, result) => {
                if (!err) {
                    console.log('✅ Admin-User erfolgreich erstellt');
                } else {
                    console.error('❌ Admin-User Erstellung fehlgeschlagen:', err);
                }
            });
        } else {
            console.log('ℹ️ Admin-User existiert bereits');
        }
    });
}, 2000);
    
// Login - POSTGRESQL-KOMPATIBEL
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    console.log('🔐 Login-Versuch für:', username);
    
    // Direkte PostgreSQL-Query ohne Wrapper
    pool.query('SELECT * FROM users WHERE username = $1 AND status = $2', 
               [username, 'approved'], (err, result) => {
        if (err) {
            console.error('❌ Login DB-Fehler:', err);
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        const user = result.rows[0];
        console.log('👤 Benutzer gefunden:', user ? user.username : 'Nicht gefunden');
        
        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            console.log('❌ Login fehlgeschlagen: Ungültige Daten');
            return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
        }
        
        console.log('✅ Login erfolgreich für:', user.username);
        
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
    });
});

// Registrierung beantragen
app.post('/api/register', (req, res) => {
    const { username, password, fullName, reason } = req.body;
    
    if (!username || !password || !fullName || !reason) {
        return res.status(400).json({ error: 'Alle Felder sind erforderlich' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });
    }
    
    const passwordHash = bcrypt.hashSync(password, 10);
    
    db.run(`INSERT INTO registrations (username, password_hash, full_name, reason) 
        VALUES ($1, $2, $3, $4)`, 
        [username, passwordHash, fullName, reason],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: 'Benutzername bereits vergeben' });
                    }
                    return res.status(500).json({ error: 'Datenbankfehler' });
                }
                
                res.json({ success: true, registrationId: this.lastID });
            });
});

// Wartende Registrierungen abrufen
app.get('/api/pending-registrations', (req, res) => {
    db.all('SELECT * FROM registrations WHERE status = $1 ORDER BY created_at DESC', ['pending'], (err, rows) => {
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
    
    db.get('SELECT * FROM registrations WHERE id = $1', [id], (err, registration) => {
        if (err || !registration) {
            return res.status(404).json({ error: 'Registrierung nicht gefunden' });
        }
        
        // Benutzer mit Standard-Rang 'besucher' erstellen
        db.run(`INSERT INTO users (username, password_hash, full_name, rank, role, status, approved_by, approved_at) 
        VALUES ($1, $2, $3, 'besucher', 'user', 'approved', ?, CURRENT_TIMESTAMP)`,
        [registration.username, registration.password_hash, registration.full_name, adminUsername], (err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Fehler beim Erstellen des Benutzers' });
                    }
                    
                    db.run(`UPDATE registrations SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = $1`,
                            [adminUsername, id], (err) => {
                                if (err) {
                                    return res.status(500).json({ error: 'Fehler beim Update der Registrierung' });
                                }
                                
                                // Log-Eintrag für Genehmigung
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
    
    db.get('SELECT * FROM registrations WHERE id = $1', [id], (err, registration) => {
        if (err || !registration) {
            return res.status(404).json({ error: 'Registrierung nicht gefunden' });
        }
        
        db.run(`UPDATE registrations SET status = 'rejected', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [adminUsername, id], (err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Datenbankfehler' });
                    }
                    
                    // Log-Eintrag für Ablehnung
                    createLogEntry('USER_REJECTED', adminUsername, 'admin', `Registrierungsantrag von ${registration.username} abgelehnt`, registration.username, req.ip);
                    
                    res.json({ success: true });
                });
    });
});

// Alle Benutzer abrufen
app.get('/api/users', (req, res) => {
    db.all('SELECT id, username, full_name, rank, role, status, created_at, approved_by, approved_at FROM users ORDER BY created_at DESC', (err, rows) => {
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
    
    // Prüfen ob Rang gültig ist
    const validRanks = ['nc-team', 'president', 'vice-president', 'admin', 'kabinettsmitglied', 
                        'socom-operator', 'user', 'besucher'];
    
    if (!validRanks.includes(rank)) {
        return res.status(400).json({ error: 'Ungültiger Rang' });
    }
    
    // Admin kann nicht degradiert werden
    db.get('SELECT username FROM users WHERE id = $1', [id], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }
        
        if (user.username === 'admin' && rank !== 'admin') {
            return res.status(403).json({ error: 'Admin-Rang kann nicht geändert werden' });
        }
        
        db.run('UPDATE users SET rank = ? WHERE id = $1', [rank, id], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Datenbankfehler' });
            }
            
            // Log-Eintrag für Rang-Änderung
            createLogEntry('USER_RANK_UPDATED', adminUsername, 'admin', `Rang geändert zu ${rank}`, user.username, req.ip);
            
            res.json({ success: true });
        });
    });
});

// Benutzer löschen
app.delete('/api/users/:id', (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT username FROM users WHERE id = $1', [id], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }
        
        if (user.username === 'admin') {
            return res.status(403).json({ error: 'Admin kann nicht gelöscht werden' });
        }
        
        db.run('DELETE FROM users WHERE id = $1', [id], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Datenbankfehler' });
            }
            
            // Log-Eintrag für Löschung
            createLogEntry('USER_DELETED', 'admin', 'admin', `Benutzer ${user.username} entfernt`, user.username, req.ip);
            
            res.json({ success: true });
        });
    });
});

// Dark Mode Update
app.post('/api/update-dark-mode', (req, res) => {
    const { username, darkMode } = req.body;
    
    db.run('UPDATE users SET dark_mode = ? WHERE username = $1', 
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
    
    db.get('SELECT dark_mode FROM users WHERE username = $1', [username], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        res.json({ darkMode: row ? row.dark_mode === 1 : false });
    });
});

// Username Change Request einreichen
app.post('/api/request-username-change', (req, res) => {
    const { currentUsername, newUsername, reason } = req.body;
    
    if (!currentUsername || !newUsername || !reason) {
        return res.status(400).json({ error: 'Alle Felder sind erforderlich' });
    }
    
    if (newUsername.length < 3 || newUsername.length > 20) {
        return res.status(400).json({ error: 'Benutzername muss zwischen 3 und 20 Zeichen haben' });
    }
    
    // Prüfen ob neuer Username bereits existiert
    db.get('SELECT username FROM users WHERE username = $1', [newUsername], (err, existingUser) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        
        if (existingUser) {
            return res.status(400).json({ error: 'Gewünschter Benutzername ist bereits vergeben' });
        }
        
        db.run(`INSERT INTO username_change_requests (current_username, new_username, reason) 
                VALUES ($1, $2, $3)`, 
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
    db.all('SELECT * FROM username_change_requests WHERE status = $1 ORDER BY created_at DESC', ['pending'], (err, rows) => {
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
    
    db.get('SELECT * FROM username_change_requests WHERE id = $1', [id], (err, request) => {
        if (err || !request) {
            return res.status(404).json({ error: 'Antrag nicht gefunden' });
        }
        
        // Prüfen ob neuer Username immer noch verfügbar ist
        db.get('SELECT username FROM users WHERE username = $1', [request.new_username], (err, existingUser) => {
            if (err) {
                return res.status(500).json({ error: 'Datenbankfehler' });
            }
            
            if (existingUser) {
                return res.status(400).json({ error: 'Gewünschter Benutzername ist inzwischen vergeben' });
            }
            
            // Username in users Tabelle ändern
            db.run('UPDATE users SET username = $1 WHERE username = $2', 
                   [request.new_username, request.current_username], (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Fehler beim Username-Update' });
                }
                
                // Request als genehmigt markieren
                db.run(`UPDATE username_change_requests SET status = 'approved', approved_by = $1, approved_at = CURRENT_TIMESTAMP WHERE id = $2`,
                       [adminUsername, id], (err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Datenbankfehler' });
                    }
                    
                    // Log-Eintrag für Username-Änderung
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
    
    db.get('SELECT * FROM username_change_requests WHERE id = $1', [id], (err, request) => {
        if (err || !request) {
            return res.status(404).json({ error: 'Antrag nicht gefunden' });
        }
        
        db.run(`UPDATE username_change_requests SET status = 'rejected', approved_by = $1, approved_at = CURRENT_TIMESTAMP WHERE id = $2`,
               [adminUsername, id], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Datenbankfehler' });
            }
            
            // Log-Eintrag für Ablehnung
            createLogEntry('USERNAME_CHANGE_REJECTED', adminUsername, 'admin', `Username-Änderungsantrag von ${request.current_username} abgelehnt`, request.current_username, req.ip);
            
            res.json({ success: true });
        });
    });
});

// System Log abrufen (nur für Admin)
app.get('/api/system-log', (req, res) => {
    db.all('SELECT * FROM system_log ORDER BY created_at DESC LIMIT 100', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        res.json(rows || []);
    });
});

// ✅ KORRIGIERTE Dokument erstellen Route (ersetzen Sie die bestehende)
app.post('/api/create-document', (req, res) => {
    console.log('📝 /api/create-document aufgerufen');
    console.log('📋 Request Body:', req.body);
    
    const { fullName, birthDate, address, phone, purpose, 
        applicationDate, additional, createdBy } = req.body;
    
    // ✅ KORRIGIERTE Validierung (ohne email)
    if (!fullName || !purpose || !createdBy) {
        console.error('❌ Validierung fehlgeschlagen:', { fullName, purpose, createdBy });
        return res.status(400).json({ error: 'Name, Zweck und Ersteller sind erforderlich' });
    }
    
    console.log('✅ Validierung erfolgreich, füge in Datenbank ein...');
    // ✅ KORRIGIERTE Log-Zeile (ohne email)
    console.log('📊 SQL Parameter:', [fullName, birthDate, address, phone, purpose, applicationDate, additional, createdBy]);
    
    // ✅ KORRIGIERTES SQL - Parameter-Anzahl stimmt jetzt überein
    db.run(`INSERT INTO documents (full_name, birth_date, address, phone, 
        purpose, application_date, additional_info, created_by, document_type) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [fullName, birthDate, address, phone, purpose, 
         applicationDate, additional, createdBy, 'manual'],
            //                                    ^^^^^^^^^ 
            //                        Jetzt 9 Parameter für 9 Felder
            function(err) {
                if (err) {
                    console.error('❌ Datenbank-Fehler beim Erstellen des Dokuments:', err);
                    console.error('❌ SQL Query war:', 'INSERT INTO documents...');
                    console.error('❌ Parameter waren:', [fullName, birthDate, address, phone, purpose, applicationDate, additional, createdBy, 'manual']);
                    return res.status(500).json({ error: 'Fehler beim Speichern: ' + err.message });
                }
                
                console.log('✅ Dokument erfolgreich erstellt mit ID:', this.lastID);
                
                // Erstelle Log-Eintrag
                createLogEntry('DOCUMENT_CREATED', createdBy, 'user', `Dokument "${purpose}" erstellt`, null, req.ip);
                
                res.json({ success: true, documentId: this.lastID });
            });
});

// Dokumente eines Benutzers abrufen (mit Debug)
app.get('/api/documents/:username', (req, res) => {
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
    
    // Filter basierend auf Typ anwenden
    if (filterType === 'manual') {
        query += ` AND d.document_type = 'manual'`;
        console.log('🔍 Filter: Nur manuelle Dokumente');
    } else if (filterType === 'template' && templateId) {
        query += ` AND tr.template_id = ?`;
        queryParams.push(templateId);
        console.log('🔍 Filter: Nur Template ID', templateId);
    } else if (filterType === 'template') {
        query += ` AND d.document_type = 'template'`;
        console.log('🔍 Filter: Alle Fragebogen-Dokumente');
    }
    // Wenn filterType === 'all' oder undefined, keine zusätzlichen Filter
    
    query += ` ORDER BY d.created_at DESC`;
    
    console.log('📋 SQL Query:', query);
    console.log('📋 Query Params:', queryParams);
    
    db.all(query, queryParams, (err, rows) => {
        if (err) {
            console.error('❌ Datenbank-Fehler beim Laden der Dokumente:', err);
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        console.log('📊 Dokumente gefunden für', username + ':', rows ? rows.length : 'null');
        if (rows && rows.length > 0) {
            console.log('📋 Erste 3 Dokumente:', rows.slice(0, 3).map(doc => ({
                id: doc.id,
                full_name: doc.full_name,
                document_type: doc.document_type,
                template_name: doc.template_name
            })));
        }
        
        res.json(rows || []);
    });
});

// ✅ HINZUGEFÜGT: Dokument löschen
app.delete('/api/documents/:id', (req, res) => {
    const { id } = req.params;
    console.log('🗑️ /api/documents/:id DELETE aufgerufen für ID:', id);
    
    if (!id || isNaN(id)) {
        console.error('❌ Ungültige Dokument-ID:', id);
        return res.status(400).json({ error: 'Ungültige Dokument-ID' });
    }
    
    // Prüfe ob Dokument existiert
    db.get('SELECT * FROM documents WHERE id = $1', [id], (err, document) => {
        if (err) {
            console.error('❌ Datenbank-Fehler beim Prüfen des Dokuments:', err);
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        if (!document) {
            console.error('❌ Dokument nicht gefunden mit ID:', id);
            return res.status(404).json({ error: 'Dokument nicht gefunden' });
        }
        
        console.log('📄 Zu löschendes Dokument gefunden:', document);
        
        // Lösche das Dokument
        db.run('DELETE FROM documents WHERE id = $1', [id], function(err) {
            if (err) {
                console.error('❌ Fehler beim Löschen des Dokuments:', err);
                return res.status(500).json({ error: 'Fehler beim Löschen: ' + err.message });
            }
            
            if (this.changes === 0) {
                console.error('❌ Kein Dokument wurde gelöscht (changes = 0)');
                return res.status(404).json({ error: 'Dokument konnte nicht gelöscht werden' });
            }
            
            console.log('✅ Dokument erfolgreich gelöscht, ID:', id, 'Changes:', this.changes);
            
            // Log-Eintrag erstellen
            createLogEntry('DOCUMENT_DELETED', document.created_by, 'user', `Dokument "${document.purpose}" gelöscht (ID: ${id})`, null, req.ip);
            
            res.json({ success: true, message: 'Dokument erfolgreich gelöscht' });
        });
    });
});

// G-Docs Template erstellen (GEÄNDERT: mit DOCX-Upload)
app.post('/api/create-gdocs-template', upload.single('templateFile'), (req, res) => {
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
    
    db.run(`INSERT INTO gdocs_templates (name, description, file_path, original_filename, available_ranks, questions, created_by) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [name, description, req.file.path, req.file.originalname, ranksString, questionsString, createdBy],
            function(err) {
                if (err) {
                    console.error('Template-Upload Fehler:', err);
                    return res.status(500).json({ error: 'Fehler beim Speichern der Vorlage' });
                }
                
                console.log('✅ Template erfolgreich hochgeladen:', req.file.originalname);
                
                // Log-Eintrag
                const questionsCount = questionsString ? JSON.parse(questionsString).length : 0;
                createLogEntry('TEMPLATE_CREATED', createdBy, 'admin', `DOCX-Vorlage "${name}" mit ${questionsCount} Fragen hochgeladen`, null, req.ip);
                
                res.json({ success: true, templateId: this.lastID });
            });
});

// DOCX-Datei herunterladen
app.get('/api/download-template/:id', (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT * FROM gdocs_templates WHERE id = $1', [id], (err, template) => {
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

// Alle G-Docs Templates abrufen (für Admin)
app.get('/api/gdocs-templates', (req, res) => {
    db.all('SELECT * FROM gdocs_templates ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        res.json(rows || []);
    });
});

// Einzelnes G-Docs Template abrufen
app.get('/api/gdocs-template/:id', (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT * FROM gdocs_templates WHERE id = $1', [id], (err, template) => {
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
    
db.all(`SELECT * FROM gdocs_templates 
        WHERE available_ranks LIKE $1 OR available_ranks LIKE $2 
        ORDER BY created_at DESC`, 
        [`%${rank}%`, '%admin%'], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        res.json(rows || []);
    });
});

// Template-Typen für Filterung abrufen
app.get('/api/template-types', (req, res) => {
    console.log('📋 /api/template-types aufgerufen - Lade verfügbare Template-Typen');
    
    // Alle Templates mit Anzahl der zugehörigen Dokumente laden
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
    
    db.all(query, [], (err, templates) => {
        if (err) {
            console.error('❌ Fehler beim Laden der Template-Typen:', err);
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        console.log('📊 Template-Typen gefunden:', templates ? templates.length : 'null');
        
        // Zusätzlich manuelle Dokumente zählen
        db.get(`SELECT COUNT(*) as count FROM documents WHERE document_type = 'manual'`, [], (err, manualCount) => {
            const result = {
                templates: templates || [],
                manualDocumentsCount: manualCount ? manualCount.count : 0
            };
            
            console.log('📋 Template-Typen Antwort:', result);
            res.json(result);
        });
    });
});

// ✅ KORRIGIERTE Template-Antwort API (POST)
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
        const template = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM gdocs_templates WHERE id = $1', [templateId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!template) {
            return res.status(404).json({ error: 'Template nicht gefunden' });
        }
        
        console.log('📄 Template gefunden:', template.name);
        
        // 2. Template-Antwort in DB speichern
        const responseId = await new Promise((resolve, reject) => {
            db.run(`INSERT INTO template_responses (template_id, answers, submitted_by) 
                    VALUES ($1, $2, $3)`,
                    [templateId, answersString, submittedBy],
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
        });
        
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
        let email = '';
        let phone = '';
        let address = '';
        let birthDate = '';
        let additionalInfo = '';
        
        // Extrahiere relevante Daten aus den Antworten
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
        
        console.log('📊 Extrahierte Daten:', { fullName, email, phone, address, birthDate });
        
        // 5. Dokument in DB erstellen
        const purpose = `Fragebogen: ${template.name}`;
        const applicationDate = new Date().toISOString().split('T')[0];
        
        const documentId = await new Promise((resolve, reject) => {
            db.run(`INSERT INTO documents (full_name, birth_date, address, phone, 
        purpose, application_date, additional_info, created_by, template_response_id, 
        document_type, generated_docx_path, generated_filename, file_number) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [fullName, birthDate, address, phone, purpose, 
         applicationDate, additionalInfo.trim(), submittedBy, responseId, 'template',
         generatedDocxPath, generatedFilename, generatedFileNumber],
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
        });
        
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

// ✅ Template-Antworten für Admin abrufen (GET) - NUR EINMAL!
app.get('/api/template-responses/:templateId', (req, res) => {
    const { templateId } = req.params;
    
    db.all(`SELECT tr.*, u.full_name, gt.name as template_name 
            FROM template_responses tr 
            LEFT JOIN users u ON tr.submitted_by = u.username 
            LEFT JOIN gdocs_templates gt ON tr.template_id = gt.id 
            WHERE tr.template_id = $1
            ORDER BY tr.created_at DESC`, 
            [templateId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        res.json(rows || []);
    });
});

// G-Docs Template löschen
app.delete('/api/gdocs-templates/:id', (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT name FROM gdocs_templates WHERE id = $1', [id], (err, template) => {
        if (err || !template) {
            return res.status(404).json({ error: 'Vorlage nicht gefunden' });
        }
        
        // Erst zugehörige Antworten löschen
        db.run('DELETE FROM template_responses WHERE template_id = ?', [id], (err) => {
            if (err) {
                console.error('Fehler beim Löschen der Template-Antworten:', err);
            }
            
            // Dann Template löschen
            db.run('DELETE FROM gdocs_templates WHERE id = $1', [id], (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Datenbankfehler' });
                }
                
                // Log-Eintrag
                createLogEntry('GDOCS_TEMPLATE_DELETED', 'admin', 'admin', `G-Docs Vorlage "${template.name}" gelöscht`, null, req.ip);
                
                res.json({ success: true });
            });
        });
    });
});

// Test-Endpoint für Datenbank-Verbindung
app.get('/api/test-db', (req, res) => {
    console.log('🧪 Datenbank-Test aufgerufen');
    
    // Teste Verbindung
    db.get("SELECT NOW() as current_time", (err, row) => {
        if (err) {
            console.error('❌ Datenbank-Verbindung fehlgeschlagen:', err);
            return res.status(500).json({ error: 'Datenbank-Verbindung fehlgeschlagen: ' + err.message });
        }
        
        console.log('✅ Datenbank-Verbindung erfolgreich, Zeit:', row.current_time);
        
        // Teste documents Tabelle
        db.all("SELECT COUNT(*) as count FROM documents", (err, countResult) => {
            if (err) {
                console.error('❌ Documents Tabelle nicht verfügbar:', err);
                return res.json({ 
                    success: true, 
                    database_time: row.current_time,
                    documents_table: false,
                    error: err.message 
                });
            }
            
            console.log('✅ Documents Tabelle verfügbar, Anzahl Einträge:', countResult[0].count);
            
            res.json({ 
                success: true, 
                database_time: row.current_time,
                documents_table: true,
                documents_count: countResult[0].count
            });
        });
    });
});

// ⚡ TEMPORÄRER SCHEMA-FIX ENDPOINT
// Füge das am Ende von server.js hinzu, VOR der app.listen() Zeile

app.get('/api/fix-database-schema', (req, res) => {
    console.log('🔧 Repariere Datenbank-Schema...');
    
    // Schritt 1: Prüfe aktuelle Tabellen-Struktur
    db.all("PRAGMA table_info(users)", (err, userColumns) => {
        if (err) {
            console.error('❌ Users Tabelle Fehler:', err);
            return res.json({ error: 'Users Tabelle Fehler: ' + err.message });
        }
        
        db.all("PRAGMA table_info(documents)", (err2, docColumns) => {
            if (err2) {
                console.error('❌ Documents Tabelle Fehler:', err2);
                return res.json({ error: 'Documents Tabelle Fehler: ' + err2.message });
            }
            
            const hasUserEmail = userColumns.find(col => col.name === 'email');
            const hasDocEmail = docColumns.find(col => col.name === 'email');
            
            let results = {
                status: 'Schema-Check durchgeführt',
                before: {
                    users_has_email: !!hasUserEmail,
                    documents_has_email: !!hasDocEmail,
                    users_columns: userColumns.map(c => c.name),
                    documents_columns: docColumns.map(c => c.name),
                    total_users_columns: userColumns.length,
                    total_documents_columns: docColumns.length
                },
                fixes_applied: [],
                success: true
            };
            
            console.log('📊 Tabellen-Analyse:', {
                users_has_email: !!hasUserEmail,
                documents_has_email: !!hasDocEmail
            });
            
            // Schritt 2: Entferne email-Spalten falls vorhanden
            let fixesNeeded = 0;
            let fixesCompleted = 0;
            
            if (hasUserEmail) {
                fixesNeeded++;
                console.log('🔧 Entferne email-Spalte aus users Tabelle...');
                db.run("ALTER TABLE users DROP COLUMN email", (err) => {
                    if (err) {
                        console.error('❌ Users email drop failed:', err);
                        results.fixes_applied.push('❌ Users email: ' + err.message);
                    } else {
                        console.log('✅ Users email-Spalte erfolgreich entfernt');
                        results.fixes_applied.push('✅ Users email-Spalte entfernt');
                    }
                    fixesCompleted++;
                    checkIfDone();
                });
            } else {
                results.fixes_applied.push('ℹ️ Users Tabelle hat keine email-Spalte');
                console.log('ℹ️ Users Tabelle hat keine email-Spalte');
            }
            
            if (hasDocEmail) {
                fixesNeeded++;
                console.log('🔧 Entferne email-Spalte aus documents Tabelle...');
                db.run("ALTER TABLE documents DROP COLUMN email", (err) => {
                    if (err) {
                        console.error('❌ Documents email drop failed:', err);
                        results.fixes_applied.push('❌ Documents email: ' + err.message);
                    } else {
                        console.log('✅ Documents email-Spalte erfolgreich entfernt');
                        results.fixes_applied.push('✅ Documents email-Spalte entfernt');
                    }
                    fixesCompleted++;
                    checkIfDone();
                });
            } else {
                results.fixes_applied.push('ℹ️ Documents Tabelle hat keine email-Spalte');
                console.log('ℹ️ Documents Tabelle hat keine email-Spalte');
            }
            
            // Schritt 3: Prüfe Ergebnis nach Fixes
            function checkIfDone() {
                if (fixesCompleted >= fixesNeeded) {
                    // Alle Fixes sind fertig, prüfe Ergebnis
                    setTimeout(() => {
                        db.all("PRAGMA table_info(users)", (err3, newUserCols) => {
                            db.all("PRAGMA table_info(documents)", (err4, newDocCols) => {
                                results.after = {
                                    users_columns: newUserCols ? newUserCols.map(c => c.name) : [],
                                    documents_columns: newDocCols ? newDocCols.map(c => c.name) : [],
                                    users_has_email: newUserCols ? newUserCols.some(c => c.name === 'email') : false,
                                    documents_has_email: newDocCols ? newDocCols.some(c => c.name === 'email') : false
                                };
                                
                                console.log('🎉 Schema-Fix abgeschlossen:', results);
                                res.json(results);
                            });
                        });
                    }, 500);
                }
            }
            
            // Falls keine Fixes nötig waren, sofort antworten
            if (fixesNeeded === 0) {
                results.after = results.before;
                console.log('ℹ️ Keine Schema-Fixes nötig');
                res.json(results);
            }
        });
    });
});
// In server.js hinzufügen:

// Database Admin Interface
app.get('/admin/database', (req, res) => {
    res.send(`
        <html>
        <head><title>Database Admin</title></head>
        <body style="font-family: Arial; padding: 20px;">
            <h1>🗃️ Database Admin Interface</h1>
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
app.post('/admin/sql', express.urlencoded({ extended: true }), (req, res) => {
    const { query } = req.body;
    
    if (query.toLowerCase().startsWith('select')) {
        // Read-only queries
        db.all(query, (err, rows) => {
            if (err) {
                res.json({ error: err.message });
            } else {
                res.json({ success: true, data: rows });
            }
        });
    } else {
        // Write queries (ALTER, UPDATE, DELETE, etc.)
        db.run(query, function(err) {
            if (err) {
                res.json({ error: err.message });
            } else {
                res.json({ success: true, changes: this.changes });
            }
        });
    }
});

// Debug-Endpoint für Storage-Status
app.get('/api/debug/storage', (req, res) => {
    const stats = {
        databaseType: 'PostgreSQL',
        databaseUrl: process.env.DATABASE_URL ? 'Configured' : 'Missing',
        uploadsPath: uploadsBasePath,
        uploadsExists: fs.existsSync(uploadsBasePath),
        nodeEnv: process.env.NODE_ENV,
        railwayEnvironment: process.env.RAILWAY_ENVIRONMENT || 'Not set'
    };
    
    // Test PostgreSQL connection
    pool.query('SELECT NOW() as current_time', (err, result) => {
        if (err) {
            stats.databaseConnection = 'Failed: ' + err.message;
        } else {
            stats.databaseConnection = 'Connected';
            stats.databaseTime = result.rows[0].current_time;
        }
        
        res.json(stats);
    });
});

// Server starten
// Datenbank initialisieren und dann Server starten
// Server starten
// Datenbank initialisieren und dann Server starten
initializeDatabase().then((success) => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🏛️ Regierungspanel läuft auf Port ${PORT}`);
        console.log('✅ Datenbank initialisiert!');
        
        // Teste Datenbankverbindung
        db.get("SELECT NOW() as current_time", (err, row) => {
            if (err) {
                console.error('❌ PostgreSQL-Test fehlgeschlagen:', err);
            } else {
                console.log('✅ PostgreSQL funktioniert, Zeit:', row.current_time);
            }
        });
    });
});

// Graceful shutdown für PostgreSQL
process.on('SIGINT', () => {
    console.log('🛑 Server wird heruntergefahren...');
    db.close((err) => {
        if (err) {
            console.error('❌ PostgreSQL-Verbindung schließen fehlgeschlagen:', err);
        } else {
            console.log('✅ PostgreSQL-Verbindung geschlossen.');
        }
        process.exit(0);
    });
});















































