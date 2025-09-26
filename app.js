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

const BOT_SIGNATURE = '\u200B'; // Karakter tak terlihat

async function getAIResponse(userInput, userName) {
    try {
        const instructions = `Anda adalah Diko, Asisten AI Pendidikan yang ramah. Selalu jawab dalam bahasa Indonesia dengan sopan dan tambahkan sedikit emoji yang relevan. Sapa pengguna bernama "${userName}". Jika Anda tidak tahu jawabannya, katakan saja "Maaf, Diko belum tahu tentang itu."`;
        const response = await openai.responses.create({
            model: "gpt-5-mini",
            instructions: instructions,
            input: userInput,
        });
        return response.output_text + BOT_SIGNATURE;
    } catch (error) {
        console.error("Error saat memanggil OpenAI API:", error);
        return "Aduh, maaf, sepertinya ada sedikit gangguan di sistem Diko. 😴" + BOT_SIGNATURE;
    }
}

// --- FUNGSI BARU UNTUK VISION ---
async function getAIResponseWithImage(caption, userName, imageBase64) {
    try {
        const fullCaption = `Pengguna bernama "${userName}" mengirim gambar ini dengan caption: "${caption}". Jelaskan apa yang ada di dalam gambar ini secara singkat dan menarik.`;

        const response = await openai.responses.create({
            // Pastikan menggunakan model yang mendukung vision, contoh: gpt-4o, gpt-4-turbo
            model: "gpt-5-mini", 
            input: [
                {
                    role: "user",
                    content: [
                        { type: "input_text", text: fullCaption },
                        {
                            type: "input_image",
                            image_url: `data:image/jpeg;base64,${imageBase64}`,
                        },
                    ],
                },
            ],
            // max_tokens: 150, // Opsional: batasi panjang jawaban
        });
        
        return response.output_text + BOT_SIGNATURE;
    } catch (error) {
        console.error("Error saat memanggil OpenAI Vision API:", error);
        return "Aduh, maaf, Diko kesulitan melihat gambar ini. 😴" + BOT_SIGNATURE;
    }
}

async function connectToWhatsApp() {
    // --- TAMBAHKAN downloadMediaMessage ---
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, jidNormalizedUser, downloadMediaMessage } = await import('@whiskeysockets/baileys');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        browser: Browsers.macOS('Desktop'),
        auth: state,
    });
    
    // ... (kode connection.update dan creds.update tetap sama) ...
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("QR Code diterima, silakan scan:");
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
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
            const senderName = msg.pushName || "User";

            // Ekstrak info pesan
            const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
            const imageMessage = msg.message?.imageMessage;
            const caption = imageMessage?.caption?.toLowerCase() || "";
            
            // Ekstrak info balasan
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            const quotedMessageText = contextInfo?.quotedMessage?.conversation || contextInfo?.quotedMessage?.extendedTextMessage?.text || "";
            const isReplyToBot = quotedMessageText.endsWith(BOT_SIGNATURE);

            // PRIORITAS 1: Jika ada yang me-reply pesan bot
            if (isReplyToBot) {
                console.log(`[REPLY DETECTED] Bot di-reply oleh ${senderName}.`);
                const cleanQuotedText = quotedMessageText.replace(BOT_SIGNATURE, '');
                const chatHistory = [
                    { role: "assistant", content: cleanQuotedText },
                    { role: "user", content: messageText }
                ];
                const aiReply = await getAIResponse(chatHistory, senderName);
                await sock.sendMessage(sender, { text: aiReply }, { quoted: msg });
            
            // PRIORITAS 2: Jika ada gambar dengan caption 'diko'
            } else if (imageMessage && caption.includes('diko')) {
                console.log(`[IMAGE DETECTED] Gambar dengan caption 'diko' dari ${senderName}.`);

                await sock.sendPresenceUpdate('composing', sender);
                
                // Unduh gambar menjadi buffer
                const imageBuffer = await downloadMediaMessage(msg, 'buffer', {});
                // Konversi ke Base64
                const imageBase64 = imageBuffer.toString('base64');

                // Panggil fungsi AI Vision
                const aiReply = await getAIResponseWithImage(imageMessage.caption, senderName, imageBase64);
                
                await sock.sendMessage(sender, { text: aiReply }, { quoted: msg });
                await sock.sendPresenceUpdate('paused', sender);
            
            // PRIORITAS 3: Jika tidak ada reply atau gambar, cek kata kunci 'diko' di teks
            } else if (messageText.toLowerCase().includes('diko')) {
                console.log(`[KEYWORD DETECTED] Keyword 'diko' dari ${senderName}.`);
                const aiReply = await getAIResponse(messageText, senderName);
                await sock.sendMessage(sender, { text: aiReply }, { quoted: msg });
            }
        }
    });
}

connectToWhatsApp();