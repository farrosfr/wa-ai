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

// --- PERUBAHAN 1: Definisikan "Tanda Tangan" di luar fungsi ---
// Kita gunakan Zero-Width Space, karakter yang tidak terlihat oleh mata manusia.
const BOT_SIGNATURE = '\u200B';

async function getAIResponse(userInput, userName) {
    try {
        const instructions = `Anda adalah Diko, Asisten AI Pendidikan yang ramah. 
        Selalu jawab dalam bahasa Indonesia dengan sopan dan tambahkan sedikit emoji yang relevan. 
        Sapa pengguna bernama "${userName}". Jika Anda tidak tahu jawabannya, katakan saja "Maaf, Diko belum tahu tentang itu."`;

        const response = await openai.responses.create({
            model: "gpt-5-mini",
            instructions: instructions,
            input: userInput,
        });
        
        // --- PERUBAHAN 2: Tambahkan tanda tangan ke setiap respons AI ---
        return response.output_text + BOT_SIGNATURE;

    } catch (error) {
        console.error("Error saat memanggil OpenAI API:", error);
        return "Aduh, maaf, sepertinya ada sedikit gangguan di sistem Diko. 😴" + BOT_SIGNATURE;
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
            if (shouldReconnect) connectToWhatsApp();
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

            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            const quotedMessageText = contextInfo?.quotedMessage?.conversation || contextInfo?.quotedMessage?.extendedTextMessage?.text || "";
            
            // --- PERUBAHAN 3: Logika deteksi balasan yang baru ---
            // Cek apakah pesan yang dibalas diakhiri dengan tanda tangan bot kita.
            const isReplyToBot = quotedMessageText.endsWith(BOT_SIGNATURE);

            if (contextInfo) {
                console.log(`[DEBUG] Pesan ini adalah balasan.`);
                console.log(`   > Teks pesan yg dibalas: "${quotedMessageText.slice(0, 20)}..."`);
                console.log(`   > Apakah ini balasan untuk bot? : ${isReplyToBot}`);
            }
            
            if (isReplyToBot) {
                console.log(`[REPLY DETECTED] Bot di-reply oleh ${senderName}.`);
                
                // Bersihkan teks pesan yang dibalas dari tanda tangan kita
                const cleanQuotedText = quotedMessageText.replace(BOT_SIGNATURE, '');

                const chatHistory = [
                    { role: "assistant", content: cleanQuotedText },
                    { role: "user", content: messageText }
                ];

                await sock.sendPresenceUpdate('composing', sender);
                const aiReply = await getAIResponse(chatHistory, senderName);
                await sock.sendMessage(sender, { text: aiReply }, { quoted: msg });
                await sock.sendPresenceUpdate('paused', sender);

            } else if (messageText.toLowerCase().includes('diko')) {
                console.log(`[KEYWORD DETECTED] Keyword 'diko' dari ${senderName}.`);
                
                await sock.sendPresenceUpdate('composing', sender);
                const aiReply = await getAIResponse(messageText, senderName);
                await sock.sendMessage(sender, { text: aiReply }, { quoted: msg });
                await sock.sendPresenceUpdate('paused', sender);
            }
        }
    });
}

connectToWhatsApp();