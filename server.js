const express = require('express');
const cors = require('cors');
const { initDB } = require('./database');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware (HIER WURDE DAS LIMIT AUF 50 MEGABYTE ERHÖHT!)
app.use(cors());
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public')); // Frontend Ordner

// Routen einbinden
app.use('/api', routes);

// Server starten
initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Server läuft auf Port ${PORT}`);
    });
});