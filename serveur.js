const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let esp32Client = null;
let androidClients = new Map();

// Fichier pour stocker la configuration de l'appareil
const configFilePath = path.join(__dirname, 'config.json');

// Configuration par défaut
let config = {
  ssid: 'Mon_SSID_WiFi',
  password: 'Mon_MotDePasse_WiFi',
  phoneNumber: '+261000000000',
  startHour: 18,
  endHour: 6
};

// Middleware pour gérer les requêtes POST avec données JSON
app.use(express.json());

// Charger la configuration depuis le fichier au démarrage
if (fs.existsSync(configFilePath)) {
  try {
    config = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
    console.log('✅ Configuration chargée :', config);
  } catch (err) {
    console.error('❌ Erreur lors du chargement de la configuration :', err);
  }
} else {
  // Créer un fichier de configuration par défaut s'il n'existe pas
  fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2));
  console.log('✅ Configuration par défaut créée :', config);
}

// --- Endpoints pour la gestion de la configuration (utilisés par l'ESP32 et Android) ---

// Endpoint pour recevoir les configurations de l'application Android
app.post('/set-config', (req, res) => {
  const { ssid, password, phoneNumber, startHour, endHour } = req.body;

  // Mise à jour uniquement des champs fournis
  if (ssid !== undefined) config.ssid = ssid;
  if (password !== undefined) config.password = password;
  if (phoneNumber !== undefined) config.phoneNumber = phoneNumber;
  if (startHour !== undefined) config.startHour = startHour;
  if (endHour !== undefined) config.endHour = endHour;

  // Enregistrer la configuration mise à jour dans le fichier
  try {
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2));
    console.log('✅ Configuration mise à jour par l\'application Android :', config);
    res.status(200).send('Configuration mise à jour avec succès');
  } catch (err) {
    console.error('❌ Erreur lors de l\'enregistrement de la configuration :', err);
    res.status(500).send('Erreur serveur lors de l\'enregistrement');
  }
});

// Endpoint pour que l'ESP32 récupère la dernière configuration
app.get('/get-config', (req, res) => {
  res.json(config);
  console.log('⚙️ Configuration demandée par ESP32, envoyée.');
});

// --- Endpoints pour le transfert d'images ---

// Route POST pour l'envoi d'images HTTP
app.use(express.raw({
    type: 'image/jpeg',
    limit: '10mb'
}));

app.post('/upload', (req, res) => {
    try {
        if (!req.body || req.body.length === 0) {
            return res.status(400).send('Aucun fichier reçu.');
        }
        const imageBuffer = req.body;
        console.log(`✅ Image HTTP reçue (${imageBuffer.length} octets).`);

        const base64Image = imageBuffer.toString('base64');
        broadcastImageToAndroidClients(base64Image);

        res.status(200).send('Image reçue et transmise aux clients WebSocket.');
    } catch (error) {
        console.error('❌ Erreur lors du traitement de l’image :', error);
        res.status(500).send('Erreur interne du serveur.');
    }
});

// --- Gestion des connexions WebSocket ---

wss.on('connection', (ws) => {
    console.log('🔗 Nouveau client WebSocket en attente d\'identification...');

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (err) {
            console.error('❌ Erreur de parsing JSON:', err.message);
            ws.close(1002, "Message non valide");
            return;
        }

        if (data.type === 'esp32') {
            if (esp32Client) {
                esp32Client.close(1000, "Nouvelle connexion ESP32");
            }
            esp32Client = ws;
            console.log('🔗 ESP32 connecté.');
        } else if (data.type === 'android') {
            const clientId = Date.now();
            androidClients.set(clientId, ws);
            console.log('🔗 Client Android identifié. Total:', androidClients.size);
        } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Type de client inconnu.' }));
        }
    });

    ws.on('close', (code, reason) => {
        if (ws === esp32Client) {
            esp32Client = null;
            console.log(`❌ ESP32 déconnecté. Code: ${code}, Raison: ${reason}`);
        } else {
            let clientFound = false;
            androidClients.forEach((client, key) => {
                if (client === ws) {
                    androidClients.delete(key);
                    clientFound = true;
                }
            });
            if (clientFound) {
                console.log(`❌ Client Android déconnecté. Total: ${androidClients.size}`);
            }
        }
    });

    ws.on('error', (error) => {
        console.error('❌ Erreur WebSocket:', error.message);
    });
});

// Fonctions utilitaires pour la diffusion
function broadcastImageToAndroidClients(base64Data) {
    if (androidClients.size === 0) {
        console.log("⚠️ Aucun client Android n'est connecté pour recevoir l'image.");
        return;
    }
    const message = JSON.stringify({
        type: "image",
        data: base64Data
    });
    androidClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch (err) {
                console.error('❌ Erreur lors de l\'envoi de l\'image à un client Android:', err.message);
            }
        }
    });
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`🚀 Serveur WebSocket démarré sur le port ${PORT}`);
});
