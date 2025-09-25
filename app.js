const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = await import('@whiskeysockets/baileys');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        browser: Browsers.macOS('Desktop'),
        auth: state,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("QR Code diterima, silakan scan:");
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus karena ', lastDisconnect.error, ', mencoba menghubungkan kembali... ', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Koneksi berhasil tersambung!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const sender = msg.key.remoteJid;
            const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";

            console.log(`Pesan dari [${sender}]: ${messageText}`);

            if (messageText.toLowerCase() === '!ping') {
                await sock.sendMessage(sender, { text: 'Pong! 🏓' });
            }
        }
    });
}

connectToWhatsApp();
