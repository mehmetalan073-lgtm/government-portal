// server.js v23 - FIXES: Dokument-Löschung + Fragebogen als Dokumente
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

pool.connect()
    .then(client => {
        console.log('✅ PostgreSQL connected successfully');
        client.release();
    })
    .catch(err => {
        console.error('❌ PostgreSQL connection failed:', err);
        process.exit(1);
    });

// Neue Ims für DOCX-Processing
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

// ✅ HINZUFÜGEN - PostgreSQL Initialisierung:
async function initializeDatabase() {
    console.log('🔧 Initializing PostgreSQL tables...');
    
    try {
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

// Vereinfachte Funktion: Nächste B-Nummer generieren
async function getNextFileNumber() {
    return new Promise((resolve, reject) => {
        console.log('📊 Generiere nächste B-Nummer (Bewertung)...');
        
        // Hole aktuellen B-Counter und erhöhe um 1
        db.get('SELECT current_number FROM file_counters WHERE prefix = ?', ['B'], (err, row) => {
            if (err) {
                console.error('❌ Fehler beim Laden des B-Counters:', err);
                return reject(err);
            }
            
             const currentNumber = row ? row.current_number : 0;
             const nextNumber = currentNumber + 1;
            
            // Update Counter in Datenbank
            db.run('UPDATE file_counters SET current_number = ?, updated_at = CURRENT_TIMESTAMP WHERE prefix = ?', 
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
            db.get('SELECT * FROM users WHERE username = ?', [submittedBy], (err, user) => {
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

// Log-Funktion für Dokument-Ansicht (optional)
async function logDocumentViewChange(viewMode) {
    try {
        await apiCall('/log-document-view', {
            method: 'POST',
            body: JSON.stringify({
                documentId: 0, // 0 für Listenansicht
                viewedBy: currentSession.user.username,
                viewMode: viewMode
            })
        });
    } catch (error) {
        console.warn('⚠️ Log-Eintrag konnte nicht erstellt werden:', error);
    }
}

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
    db.get('SELECT name, created_by FROM gdocs_templates WHERE id = ?', [id], (err, template) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        if (!template) {
            return res.status(404).json({ error: 'Template nicht gefunden' });
        }
        
        // Aktualisiere nur die Fragen
        db.run('UPDATE gdocs_templates SET questions = ? WHERE id = ?', [questionsString, id], function(err) {
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
    
    let updateQuery = 'UPDATE gdocs_templates SET name = ?, description = ?, available_ranks = ?';
    let params = [name, description, availableRanks];
    
    // Falls neue Datei hochgeladen
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
    db.get('SELECT * FROM documents WHERE id = ?', [id], (err, document) => {
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
                full_name = ?, birth_date = ?, address = ?, phone = ?, 
                email = ?, purpose = ?, application_date = ?, additional_info = ?
                WHERE id = ?`,
                [fullName, birthDate, address, phone, email, purpose, applicationDate, additional, id],
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

// Neue Funktion: Dokument-Details-Modal anzeigen
function showDocumentDetailsModal(document) {
    const detailsModal = document.createElement('div');
    detailsModal.className = 'documents-modal active';
    detailsModal.id = 'documentDetailsModal';
    
    // Template-Antworten formatieren (falls vorhanden)
    let templateInfo = '';
    if (document.template_answers) {
        try {
            const answers = JSON.parse(document.template_answers);
            templateInfo = `
                <div style="margin-top: 20px; padding: 15px; background: #f0f8ff; border-radius: 6px; border-left: 4px solid #17a2b8;">
                    <h4 style="margin: 0 0 10px 0; color: #17a2b8;">📋 Fragebogen-Antworten</h4>
                    <p><strong>Vorlage:</strong> ${document.template_name || 'Unbekannt'}</p>
                    ${document.template_description ? `<p><strong>Beschreibung:</strong> ${document.template_description}</p>` : ''}
                    <div style="margin-top: 10px;">
                        ${Object.entries(answers).map(([key, value]) => `
                            <p style="margin: 5px 0;"><strong>${key}:</strong> ${Array.isArray(value) ? value.join(', ') : value}</p>
                        `).join('')}
                    </div>
                </div>
            `;
        } catch (e) {
            templateInfo = `
                <div style="margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 6px;">
                    <p><strong>📋 Fragebogen-Daten:</strong> Vorhanden, aber nicht lesbar</p>
                </div>
            `;
        }
    }
    
    // Ersteller-Info (erweitert)
    const creatorInfo = document.creator_full_name ? `
        <p><strong>Erstellt von:</strong> ${document.creator_full_name} (${document.created_by})
           ${document.creator_rank ? `<span class="rank-badge rank-${document.creator_rank}">${getRankDisplay(document.creator_rank)}</span>` : ''}
        </p>
        ${document.creator_email ? `<p><strong>Ersteller E-Mail:</strong> ${document.creator_email}</p>` : ''}
    ` : `<p><strong>Erstellt von:</strong> ${document.created_by}</p>`;
    
    // Dokument-Typ Badge
    const typeBadge = document.document_type === 'template' 
        ? '<span style="background: #17a2b8; color: white; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">📋 FRAGEBOGEN</span>'
        : '<span style="background: #6c757d; color: white; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">📝 MANUELL</span>';
    
    detailsModal.innerHTML = `
        <div class="documents-modal-content">
            <div class="documents-modal-header">
                <h2 class="documents-modal-title">👁️ Dokument-Details</h2>
                <button class="documents-modal-close" onclick="closeDocumentDetailsModal()">×</button>
            </div>
            <div class="documents-modal-body">
                <div style="margin-bottom: 20px; text-align: center;">
                    ${typeBadge}
                </div>
                
                <div class="document-item" style="margin: 0; box-shadow: none; border: 1px solid #e0e0e0;">
                    <div class="document-date">Erstellt: ${new Date(document.created_at).toLocaleString('de-DE')}</div>
                    <div class="document-title" style="font-size: 20px; margin-bottom: 15px;">${document.full_name} - ${document.purpose}</div>
                    <div class="document-details">
                        ${creatorInfo}
                        <p><strong>E-Mail:</strong> ${document.email}</p>
                        ${document.birth_date ? `<p><strong>Geburtsdatum:</strong> ${new Date(document.birth_date).toLocaleDateString('de-DE')}</p>` : ''}
                        ${document.address ? `<p><strong>Adresse:</strong> ${document.address}</p>` : ''}
                        ${document.phone ? `<p><strong>Telefon:</strong> ${document.phone}</p>` : ''}
                        ${document.application_date ? `<p><strong>Antragsdatum:</strong> ${new Date(document.application_date).toLocaleDateString('de-DE')}</p>` : ''}
                        ${document.additional_info ? `<p><strong>Zusätzliche Informationen:</strong><br>${document.additional_info.replace(/\n/g, '<br>')}</p>` : ''}
                    </div>
                    
                    ${templateInfo}
                </div>
                
                <div style="margin-top: 20px; text-align: right;">
                    <button onclick="closeDocumentDetailsModal()" class="btn-secondary" style="width: auto; padding: 10px 20px;">Schließen</button>
                    ${document.created_by === currentSession.user.username ? `
                        <button onclick="editDocumentFromDetails(${document.id})" class="btn-warning" style="width: auto; padding: 10px 20px; margin-left: 10px;">✏️ Bearbeiten</button>
                        <button onclick="deleteDocumentFromDetails(${document.id})" class="btn-danger" style="width: auto; padding: 10px 20px; margin-left: 10px;">🗑️ Löschen</button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(detailsModal);
}

// Dokument-Details-Modal schließen
function closeDocumentDetailsModal() {
    const modal = document.getElementById('documentDetailsModal');
    if (modal) {
        modal.remove();
    }
}

// Bearbeiten aus Details-Modal
function editDocumentFromDetails(docId) {
    closeDocumentDetailsModal();
    editDocument(docId);
}

// Löschen aus Details-Modal  
async function deleteDocumentFromDetails(docId) {
    const confirmed = confirm('Dokument wirklich löschen?');
    if (!confirmed) return;
    
    try {
        await apiCall(`/documents/${docId}`, {
            method: 'DELETE'
        });
        
        alert('🗑️ Dokument erfolgreich gelöscht!');
        closeDocumentDetailsModal();
        loadUserDocuments(); // Aktualisiere die Liste
        
    } catch (error) {
        alert(`❌ Fehler beim Löschen: ${error.message}`);
    }
}


// Erweiterte openDocumentsModal Funktion
function openDocumentsModal() {
    console.log('🔍 Dokumente-Modal wird geöffnet...');
    
    // Aktuelle Screen merken
    const currentScreen = document.querySelector('.screen.active');
    if (currentScreen) {
        documentsModalReturnScreen = currentScreen.id;
    }
    
    const modal = document.getElementById('documentsModal');
    if (modal) {
        modal.classList.add('active');
        
        // G-Docs Tab nur für Admins anzeigen
        const gdocsTabButton = document.getElementById('gdocsTabButton');
        if (gdocsTabButton && currentSession.user) {
            const hasAdminRights = hasFullAccess(currentSession.user.rank || 'user');
            gdocsTabButton.style.display = hasAdminRights ? 'block' : 'none';
        }
        
        // Auto-fill user data
        prefillUserData();
        
        // Initialisiere Dropdown
        setTimeout(() => {
            initializeDocumentsDropdown();
        }, 100);
        
        // Load initial content based on active tab
        const activeTab = document.querySelector('.documents-tab.active');
        if (activeTab && activeTab.textContent.includes('Meine Dokumente')) {
            loadUserDocuments();
        } else {
            loadAvailableTemplates();
        }
        
        console.log('✅ Modal geöffnet und initialisiert');
    }
}


// Erweiterte Frontend-Funktionen für Dokumente-Dropdown (in paste.txt einfügen)

// Erweiterte switchDocumentsTab Funktion
function switchDocumentsTab(tabName) {
    console.log('🔄 Wechsele zu Tab:', tabName);
    
    // Tab buttons
    document.querySelectorAll('.documents-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Den aktiven Tab finden und markieren
    const activeTabButton = document.querySelector(`.documents-tab[onclick*="'${tabName}'"]`);
    if (activeTabButton) {
        activeTabButton.classList.add('active');
        console.log('✅ Tab-Button aktiviert:', tabName);
    }
    
    // Alle Tab-Inhalte verstecken
    const tabContents = [
        'createDocumentTab', 
        'viewDocumentsTab', 
        'gdocsTabContent', 
        'templatesTabContent'
    ];
    
    tabContents.forEach(tabId => {
        const tab = document.getElementById(tabId);
        if (tab) {
            tab.style.display = 'none';
        }
    });
    
    // Aktiven Tab anzeigen
    let activeTabContent = null;
    
    if (tabName === 'create') {
        activeTabContent = document.getElementById('createDocumentTab');
    } else if (tabName === 'view') {
        activeTabContent = document.getElementById('viewDocumentsTab');
        // Dropdown-Status zurücksetzen wenn View-Tab geöffnet wird
        const dropdown = document.getElementById('documentsViewDropdown');
        if (dropdown && dropdown.value === '') {
            dropdown.value = 'my'; // Default zu "Meine Dokumente"
        }
    } else if (tabName === 'gdocs') {
        activeTabContent = document.getElementById('gdocsTabContent');
        if (questionCounter === 0) {
            addQuestion();
        }
    } else if (tabName === 'templates') {
        activeTabContent = document.getElementById('templatesTabContent');
    }
    
    if (activeTabContent) {
        activeTabContent.style.display = 'block';
        console.log('✅ Tab-Content angezeigt:', activeTabContent.id);
    }
    
    // Tab-spezifische Aktionen
    if (tabName === 'view') {
        loadUserDocuments(); // Lädt basierend auf Dropdown-Auswahl
    } else if (tabName === 'gdocs') {
        loadGdocsTemplates();
    } else if (tabName === 'templates') {
        loadAvailableTemplates();
    }
}

// Erweiterte loadUserDocuments Funktion
async function loadUserDocuments() {
    console.log('📄 loadUserDocuments() gestartet');
    
    if (!currentSession.user) {
        console.error('❌ Kein Benutzer für Dokumente angemeldet!');
        return;
    }
    
    const container = document.getElementById('documentsListContainer');
    if (!container) {
        console.error('❌ documentsListContainer nicht gefunden!');
        return;
    }
    
    // Prüfe Dropdown-Auswahl
    const dropdown = document.getElementById('documentsViewDropdown');
    const viewMode = dropdown ? dropdown.value : 'my';
    
    console.log('📦 Dokumente-Container gefunden, View-Modus:', viewMode);
    console.log('👤 Benutzer:', currentSession.user.username);
    
    if (viewMode === 'all') {
        container.innerHTML = '<div class="loading">Lade alle Dokumente aus SQL-Datenbank...</div>';
    } else {
        container.innerHTML = '<div class="loading">Lade meine Dokumente aus SQL-Datenbank...</div>';
    }
    
    try {
        let apiUrl, documents;
        
        if (viewMode === 'all') {
            // Lade alle Dokumente
            apiUrl = '/all-documents';
            console.log('🔗 API-Aufruf für alle Dokumente:', apiUrl);
            documents = await apiCall(apiUrl);
        } else {
            // Lade nur Benutzer-Dokumente
            apiUrl = `/documents/${currentSession.user.username}`;
            console.log('🔗 API-Aufruf für Benutzer-Dokumente:', apiUrl);
            documents = await apiCall(apiUrl);
        }
        
        console.log('📄 Dokumente von API erhalten:', documents);
        console.log('📊 Anzahl Dokumente:', documents ? documents.length : 'undefined');
        
        updateDocumentsList(documents, viewMode);
    } catch (error) {
        console.error('❌ Fehler beim Laden der Dokumente:', error);
        container.innerHTML = `<p style="color: red;">Fehler beim Laden: ${error.message}</p>`;
    }
}


// Erweiterte updateDocumentsList Funktion
function updateDocumentsList(documents, viewMode = 'my') {
    console.log('📋 updateDocumentsList() gestartet mit:', documents, 'View-Modus:', viewMode);
    
    const container = document.getElementById('documentsListContainer');
    if (!container) {
        console.error('❌ documentsListContainer in updateDocumentsList nicht gefunden!');
        return;
    }
    
    if (!documents) {
        console.warn('⚠️ Keine Dokumente übergeben (undefined/null)');
        container.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">Fehler: Keine Daten erhalten</p>';
        return;
    }
    
    if (documents.length === 0) {
        const emptyMessage = viewMode === 'all' 
            ? 'Noch keine Dokumente im System vorhanden' 
            : 'Noch keine eigenen Dokumente erstellt';
        console.log('📭', emptyMessage);
        container.innerHTML = `<p style="text-align: center; color: #666; padding: 40px;">${emptyMessage}</p>`;
        return;
    }

    console.log('🔄 Erstelle HTML für', documents.length, 'Dokumente');
    
    const documentsHtml = documents.map((doc, index) => {
        console.log(`📄 Dokument ${index + 1}:`, doc);
        
        // Zusätzliche Anzeige für "Alle Dokumente" Modus
        const creatorInfo = viewMode === 'all' && doc.created_by !== currentSession.user.username 
            ? `<p><strong>Erstellt von:</strong> <span style="color: #6a4c93; font-weight: 600;">${doc.created_by}</span></p>` 
            : '';
        
        // Zeige verschiedene Aktionen basierend auf Berechtigung
        const isOwnDocument = doc.created_by === currentSession.user.username;
        const canEdit = isOwnDocument;
        const canDelete = isOwnDocument;
        
        // DOCX Download & Vorschau Buttons
const docxButtons = doc.generated_docx_path ? `
    <button class="btn-success" onclick="downloadGeneratedDocx(${doc.id})" title="Generierte DOCX-Datei herunterladen">📥 DOCX Download</button>
    <button class="btn-secondary" onclick="previewGeneratedDocx(${doc.id})" title="DOCX-Vorschau anzeigen">👁️ Vorschau</button>
` : '';

const actionButtons = `
    <button class="btn-secondary" onclick="viewDocumentDetails(${doc.id})">👁️ Details</button>
    ${docxButtons}
    ${canEdit ? `<button class="btn-warning" onclick="editDocument(${doc.id})">✏️ Bearbeiten</button>` : ''}
    ${canDelete ? `<button class="btn-danger" onclick="deleteDocument(${doc.id})">🗑️ Löschen</button>` : ''}
`;
        
        // Document-Type Badge mit DOCX-Indikator
let typeBadge = '';
if (doc.document_type === 'template') {
    typeBadge = '<span style="background: #17a2b8; color: white; padding: 2px 8px; border-radius: 3px; font-size: 11px; margin-left: 10px;">📋 FRAGEBOGEN</span>';
    if (doc.generated_docx_path) {
        typeBadge += '<span style="background: #28a745; color: white; padding: 2px 8px; border-radius: 3px; font-size: 11px; margin-left: 5px;">📄 DOCX</span>';
    }
} else {
    typeBadge = '<span style="background: #6c757d; color: white; padding: 2px 8px; border-radius: 3px; font-size: 11px; margin-left: 10px;">📝 MANUELL</span>';
}

// DOCX-Info anzeigen falls vorhanden
const docxInfo = doc.generated_docx_path ? `
    <p><strong>Generierte Datei:</strong> 
        <span style="color: #28a745; font-weight: 600;">${doc.generated_filename || 'Verfügbar'}</span>
        <span style="font-size: 11px; background: #d4edda; color: #155724; padding: 2px 6px; border-radius: 3px; margin-left: 8px;">
            📄 DOCX verfügbar
        </span>
    </p>
` : '';
        return `
            <div class="document-item" style="${!isOwnDocument ? 'border-left: 4px solid #17a2b8;' : ''}">
                <div class="document-date">Erstellt: ${new Date(doc.created_at).toLocaleString('de-DE')}</div>
                <div class="document-title">
                    ${doc.full_name} - ${doc.purpose}
                    ${typeBadge}
                </div>
                <div class="document-details">
    ${creatorInfo}
    ${doc.birth_date ? `<p><strong>Geburtsdatum:</strong> ${new Date(doc.birth_date).toLocaleDateString('de-DE')}</p>` : ''}
    ${doc.address ? `<p><strong>Adresse:</strong> ${doc.address}</p>` : ''}
    ${doc.phone ? `<p><strong>Telefon:</strong> ${doc.phone}</p>` : ''}
    ${doc.application_date ? `<p><strong>Antragsdatum:</strong> ${new Date(doc.application_date).toLocaleDateString('de-DE')}</p>` : ''}
    ${doc.additional_info ? `<p><strong>Zusätzliche Infos:</strong> ${doc.additional_info}</p>` : ''}
    ${docxInfo}
</div>
        `;
    }).join('');

    console.log('✅ HTML erstellt, füge in Container ein...');
    container.innerHTML = documentsHtml;
    console.log('✅ Dokumente-Liste aktualisiert!');
}

// Log-Funktion für Dokument-Ansicht (optional)
async function logDocumentViewChange(viewMode) {
    try {
        await apiCall('/log-document-view', {
            method: 'POST',
            body: JSON.stringify({
                documentId: 0, // 0 für Listenansicht
                viewedBy: currentSession.user.username,
                viewMode: viewMode
            })
        });
    } catch (error) {
        console.warn('⚠️ Log-Eintrag konnte nicht erstellt werden:', error);
    }
}

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

// Neue Funktion: Dokument-Details-Modal anzeigen
function showDocumentDetailsModal(document) {
    const detailsModal = document.createElement('div');
    detailsModal.className = 'documents-modal active';
    detailsModal.id = 'documentDetailsModal';
    
    // Template-Antworten formatieren (falls vorhanden)
    let templateInfo = '';
    if (document.template_answers) {
        try {
            const answers = JSON.parse(document.template_answers);
            templateInfo = `
                <div style="margin-top: 20px; padding: 15px; background: #f0f8ff; border-radius: 6px; border-left: 4px solid #17a2b8;">
                    <h4 style="margin: 0 0 10px 0; color: #17a2b8;">📋 Fragebogen-Antworten</h4>
                    <p><strong>Vorlage:</strong> ${document.template_name || 'Unbekannt'}</p>
                    ${document.template_description ? `<p><strong>Beschreibung:</strong> ${document.template_description}</p>` : ''}
                    <div style="margin-top: 10px;">
                        ${Object.entries(answers).map(([key, value]) => `
                            <p style="margin: 5px 0;"><strong>${key}:</strong> ${Array.isArray(value) ? value.join(', ') : value}</p>
                        `).join('')}
                    </div>
                </div>
            `;
        } catch (e) {
            templateInfo = `
                <div style="margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 6px;">
                    <p><strong>📋 Fragebogen-Daten:</strong> Vorhanden, aber nicht lesbar</p>
                </div>
            `;
        }
    }
    
    // Ersteller-Info (erweitert)
    const creatorInfo = document.creator_full_name ? `
        <p><strong>Erstellt von:</strong> ${document.creator_full_name} (${document.created_by})
           ${document.creator_rank ? `<span class="rank-badge rank-${document.creator_rank}">${getRankDisplay(document.creator_rank)}</span>` : ''}
        </p>
        ${document.creator_email ? `<p><strong>Ersteller E-Mail:</strong> ${document.creator_email}</p>` : ''}
    ` : `<p><strong>Erstellt von:</strong> ${document.created_by}</p>`;
    
    // Dokument-Typ Badge
    const typeBadge = document.document_type === 'template' 
        ? '<span style="background: #17a2b8; color: white; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">📋 FRAGEBOGEN</span>'
        : '<span style="background: #6c757d; color: white; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: 600;">📝 MANUELL</span>';
    
    detailsModal.innerHTML = `
        <div class="documents-modal-content">
            <div class="documents-modal-header">
                <h2 class="documents-modal-title">👁️ Dokument-Details</h2>
                <button class="documents-modal-close" onclick="closeDocumentDetailsModal()">×</button>
            </div>
            <div class="documents-modal-body">
                <div style="margin-bottom: 20px; text-align: center;">
                    ${typeBadge}
                </div>
                
                <div class="document-item" style="margin: 0; box-shadow: none; border: 1px solid #e0e0e0;">
                    <div class="document-date">Erstellt: ${new Date(document.created_at).toLocaleString('de-DE')}</div>
                    <div class="document-title" style="font-size: 20px; margin-bottom: 15px;">${document.full_name} - ${document.purpose}</div>
                    <div class="document-details">
                        ${creatorInfo}
                        <p><strong>E-Mail:</strong> ${document.email}</p>
                        ${document.birth_date ? `<p><strong>Geburtsdatum:</strong> ${new Date(document.birth_date).toLocaleDateString('de-DE')}</p>` : ''}
                        ${document.address ? `<p><strong>Adresse:</strong> ${document.address}</p>` : ''}
                        ${document.phone ? `<p><strong>Telefon:</strong> ${document.phone}</p>` : ''}
                        ${document.application_date ? `<p><strong>Antragsdatum:</strong> ${new Date(document.application_date).toLocaleDateString('de-DE')}</p>` : ''}
                        ${document.additional_info ? `<p><strong>Zusätzliche Informationen:</strong><br>${document.additional_info.replace(/\n/g, '<br>')}</p>` : ''}
                    </div>
                    
                    ${templateInfo}
                </div>
                
                <div style="margin-top: 20px; text-align: right;">
                    <button onclick="closeDocumentDetailsModal()" class="btn-secondary" style="width: auto; padding: 10px 20px;">Schließen</button>
                    ${document.created_by === currentSession.user.username ? `
                        <button onclick="editDocumentFromDetails(${document.id})" class="btn-warning" style="width: auto; padding: 10px 20px; margin-left: 10px;">✏️ Bearbeiten</button>
                        <button onclick="deleteDocumentFromDetails(${document.id})" class="btn-danger" style="width: auto; padding: 10px 20px; margin-left: 10px;">🗑️ Löschen</button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(detailsModal);
}

// Dokument-Details-Modal schließen
function closeDocumentDetailsModal() {
    const modal = document.getElementById('documentDetailsModal');
    if (modal) {
        modal.remove();
    }
}

// Bearbeiten aus Details-Modal
function editDocumentFromDetails(docId) {
    closeDocumentDetailsModal();
    editDocument(docId);
}

// Löschen aus Details-Modal  
async function deleteDocumentFromDetails(docId) {
    const confirmed = confirm('Dokument wirklich löschen?');
    if (!confirmed) return;
    
    try {
        await apiCall(`/documents/${docId}`, {
            method: 'DELETE'
        });
        
        alert('🗑️ Dokument erfolgreich gelöscht!');
        closeDocumentDetailsModal();
        loadUserDocuments(); // Aktualisiere die Liste
        
    } catch (error) {
        alert(`❌ Fehler beim Löschen: ${error.message}`);
    }
}


// Erweiterte openDocumentsModal Funktion
function openDocumentsModal() {
    console.log('🔍 Dokumente-Modal wird geöffnet...');
    
    // Aktuelle Screen merken
    const currentScreen = document.querySelector('.screen.active');
    if (currentScreen) {
        documentsModalReturnScreen = currentScreen.id;
    }
    
    const modal = document.getElementById('documentsModal');
    if (modal) {
        modal.classList.add('active');
        
        // G-Docs Tab nur für Admins anzeigen
        const gdocsTabButton = document.getElementById('gdocsTabButton');
        if (gdocsTabButton && currentSession.user) {
            const hasAdminRights = hasFullAccess(currentSession.user.rank || 'user');
            gdocsTabButton.style.display = hasAdminRights ? 'block' : 'none';
        }
        
        // Auto-fill user data
        prefillUserData();
        
        // Initialisiere Dropdown
        setTimeout(() => {
            initializeDocumentsDropdown();
        }, 100);
        
        // Load initial content based on active tab
        const activeTab = document.querySelector('.documents-tab.active');
        if (activeTab && activeTab.textContent.includes('Meine Dokumente')) {
            loadUserDocuments();
        } else {
            loadAvailableTemplates();
        }
        
        console.log('✅ Modal geöffnet und initialisiert');
    }
}


// Backend-Erweiterung für "Alle Dokumente" - Fügen Sie dies zu server.js hinzu

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
        query += ` WHERE tr.template_id = ?`;
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
            WHERE d.id = ?`, [documentId], (err, document) => {
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
        db.run('UPDATE documents SET preview_html = ? WHERE id = ?', 
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
            WHERE d.created_by = ? AND d.generated_docx_path IS NOT NULL
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
            db.all('SELECT id FROM users WHERE status = "approved"', [], (err, activeUsers) => {
                if (!err && activeUsers) {
                    stats.activeUsers = activeUsers.length;
                }
                
                // Pending Registrierungen zählen
                db.all('SELECT id FROM registrations WHERE status = "pending"', [], (err, pendingRegs) => {
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
            console.error('❌ Datenbank-Fehler beim Laden des Dokuments:', err);
            return res.status(500).json({ error: 'Datenbankfehler: ' + err.message });
        }
        
        if (!document) {
            console.error('❌ Dokument nicht gefunden mit ID:', id);
            return res.status(404).json({ error: 'Dokument nicht gefunden' });
        }
        
        console.log('📄 Dokument-Details geladen:', {
            id: document.id,
            full_name: document.full_name,
            created_by: document.created_by,
            document_type: document.document_type
        });
        
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

    // Template Responses Tabelle (für gespeicherte Antworten)
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

    // Admin-User erstellen oder aktualisieren
    const adminPassword = bcrypt.hashSync('memo', 10);
    db.get("SELECT * FROM users WHERE username = 'admin'", (err, user) => {
        if (!user) {
            // Admin existiert nicht, erstelle ihn
            db.run(`INSERT INTO users (username, password_hash, full_name, rank, role, status) 
        VALUES ('admin', ?, 'Systemadministrator', 'admin', 'admin', 'approved')`, 
        [adminPassword], (err) => {
                        if (!err) {
                            console.log('✅ Admin-User erfolgreich erstellt');
                        }
                    });
        } else {
            // Admin existiert, stelle sicher dass rank gesetzt ist
            if (!user.rank || user.rank !== 'admin') {
                db.run("UPDATE users SET rank = 'admin' WHERE username = 'admin'", (err) => {
                    if (!err) {
                        console.log('✅ Admin-User Rang aktualisiert');
                    }
                });
            }
        }
    });
    
// API Endpoints

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get('SELECT * FROM users WHERE username = ? AND status = "approved"', [username], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Datenbankfehler' });
        }
        
        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
        }
        
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
        VALUES (?, ?, ?, ?)`, 
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
        
        // Benutzer mit Standard-Rang 'besucher' erstellen
        db.run(`INSERT INTO users (username, password_hash, full_name, rank, role, status, approved_by, approved_at) 
        VALUES (?, ?, ?, 'besucher', 'user', 'approved', ?, CURRENT_TIMESTAMP)`,
        [registration.username, registration.password_hash, registration.full_name, adminUsername], (err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Fehler beim Erstellen des Benutzers' });
                    }
                    
                    db.run(`UPDATE registrations SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?`,
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
    
    db.get('SELECT * FROM registrations WHERE id = ?', [id], (err, registration) => {
        if (err || !registration) {
            return res.status(404).json({ error: 'Registrierung nicht gefunden' });
        }
        
        db.run(`UPDATE registrations SET status = 'rejected', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?`,
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
            
            // Log-Eintrag für Rang-Änderung
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
            
            // Log-Eintrag für Löschung
            createLogEntry('USER_DELETED', 'admin', 'admin', `Benutzer ${user.username} entfernt`, user.username, req.ip);
            
            res.json({ success: true });
        });
    });
});

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
        
        // Prüfen ob neuer Username immer noch verfügbar ist
        db.get('SELECT username FROM users WHERE username = ?', [request.new_username], (err, existingUser) => {
            if (err) {
                return res.status(500).json({ error: 'Datenbankfehler' });
            }
            
            if (existingUser) {
                return res.status(400).json({ error: 'Gewünschter Benutzername ist inzwischen vergeben' });
            }
            
            // Username in users Tabelle ändern
            db.run('UPDATE users SET username = ? WHERE username = ?', 
                   [request.new_username, request.current_username], (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Fehler beim Username-Update' });
                }
                
                // Request als genehmigt markieren
                db.run(`UPDATE username_change_requests SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?`,
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
    
    db.get('SELECT * FROM username_change_requests WHERE id = ?', [id], (err, request) => {
        if (err || !request) {
            return res.status(404).json({ error: 'Antrag nicht gefunden' });
        }
        
        db.run(`UPDATE username_change_requests SET status = 'rejected', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?`,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        WHERE d.created_by = ?
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
    db.get('SELECT * FROM documents WHERE id = ?', [id], (err, document) => {
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
        db.run('DELETE FROM documents WHERE id = ?', [id], function(err) {
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
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
    
    db.all(`SELECT * FROM gdocs_templates 
            WHERE available_ranks LIKE ? OR available_ranks LIKE ? 
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
            db.get('SELECT * FROM gdocs_templates WHERE id = ?', [templateId], (err, row) => {
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
                    VALUES (?, ?, ?)`,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            WHERE tr.template_id = ? 
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
    
    db.get('SELECT name FROM gdocs_templates WHERE id = ?', [id], (err, template) => {
        if (err || !template) {
            return res.status(404).json({ error: 'Vorlage nicht gefunden' });
        }
        
        // Erst zugehörige Antworten löschen
        db.run('DELETE FROM template_responses WHERE template_id = ?', [id], (err) => {
            if (err) {
                console.error('Fehler beim Löschen der Template-Antworten:', err);
            }
            
            // Dann Template löschen
            db.run('DELETE FROM gdocs_templates WHERE id = ?', [id], (err) => {
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
    db.get("SELECT datetime('now') as current_time", (err, row) => {
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

// Statistiken abrufen - Robuste Version ohne COUNT
app.get('/api/stats', (req, res) => {
    const stats = {
        totalUsers: 0,
        pendingRegistrations: 0,
        activeUsers: 0
    };
    
    // Benutzer zählen durch Abrufen aller Zeilen
    db.all('SELECT id FROM users', [], (err, users) => {
        if (!err && users) {
            stats.totalUsers = users.length;
            
            // Aktive Benutzer zählen
            db.all('SELECT id FROM users WHERE status = "approved"', [], (err, activeUsers) => {
                if (!err && activeUsers) {
                    stats.activeUsers = activeUsers.length;
                }
                
                // Pending Registrierungen zählen
                db.all('SELECT id FROM registrations WHERE status = "pending"', [], (err, pendingRegs) => {
                    if (!err && pendingRegs) {
                        stats.pendingRegistrations = pendingRegs.length;
                    }
                    
                    // Antwort senden
                    res.json(stats);
                });
            });
        } else {
            // Falls erste Abfrage fehlschlägt, trotzdem antworten
            res.json(stats);
        }
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
// Server starten
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🏛️ Regierungspanel v23-FIXED Backend läuft auf http://localhost:${PORT}`);
    console.log(`📊 SQLite Datenbank: government_portal.db`);
    console.log(`📈 Rang-System aktiviert mit 8 verschiedenen Rängen`);
    console.log(`✅ Username-Änderungen aktiviert`);
    console.log(`📜 System-Log aktiviert`);
    console.log(`📝 G-Docs Funktion aktiviert`);
    console.log(`📋 Erweiterte Fragebogen-Funktionalität aktiviert`);
    console.log(`🔍 Debug-Modus für Dokumente-System aktiviert`);
    console.log(`🧪 Test-Endpoint verfügbar: GET /api/test-db`);
    console.log(`🗑️ FIXED: Dokument-Löschung funktioniert jetzt (DELETE /api/documents/:id)`);
    console.log(`📋 FIXED: Fragebögen werden jetzt automatisch als Dokumente gespeichert`);
    console.log(`✅ Version 23-FIXED - Alle Dokument-Funktionen arbeiten korrekt`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Datenbankverbindung geschlossen.');
        process.exit(0);
    });

});
