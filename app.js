// Memuat environment variables dari file .env
require('dotenv').config(); 
const { OpenAI } = require("openai");

// Inisialisasi client OpenAI dengan API Key dari .env
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// Fungsi terpisah untuk memanggil AI, agar kode lebih rapi
async function getAIResponse(userInput, userName) {
    try {
        // Prompt Engineering: Memberi instruksi kepada AI
        const instructions = `Anda adalah Diko Asisten pendidikan AI.
        Seorang pengguna bernama "${userName}" memanggil Anda.
        Berikan respon dengan sopan dan beri sedikit emot tidak apa-apa.
        Jawab dengan bahasa Indonesia. Jika Anda tidak tahu jawabannya, katakan Maaf, saya tidak tahu. Jangan mencoba untuk mengarang jawaban. Jangan gunakan format LaTeX.`;

        const response = await openai.responses.create({
            model: "gpt-5-mini", // Model bisa disesuaikan
            instructions: instructions,
            // 'input' sekarang bisa menerima string atau array
            input: userInput, 
        });

        // Mengambil teks dari respons AI
        return response.output_text;
    } catch (error) {
        console.error("Error saat memanggil OpenAI API:", error);
        return "Maaf, sepertinya AI sedang istirahat. Coba lagi nanti ya. 😴";
    }
}

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
            const senderName = msg.pushName || "User";

            // Cek apakah pesan berasal dari grup
            const isGroup = sender.endsWith('@g.us');
        
            console.log(`Pesan dari [${sender}]: ${messageText}`);

            if (messageText.toLowerCase() === '!ping') {
                await sock.sendMessage(sender, { text: 'Pong! 🏓' });
            }

            if (isGroup && messageText.toLowerCase().includes('diko')) {
                console.log(`Keyword 'diko' terdeteksi di grup ${sender}.`);

                const senderName = msg.pushName || "User"; // Mengambil nama pengirim
                
                // Menampilkan status "typing..." di WhatsApp
                await sock.sendPresenceUpdate('composing', sender);

                // Memanggil fungsi AI dan mendapatkan respons
                const aiReply = await getAIResponse(messageText, senderName);
                
                // Membalas pesan spesifik dari user tersebut (quoted reply)
                await sock.sendMessage(sender, { text: aiReply }, { quoted: msg });
                
                // Menghentikan status "typing..."
                await sock.sendPresenceUpdate('paused', sender);
            }
        }
    });
}

connectToWhatsApp();
