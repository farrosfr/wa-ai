require('dotenv').config();
const { OpenAI } = require("openai");
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BOT_SIGNATURE = '\u200B';

// --- PUSAT KEPRIBADIAN BOT ---
const characterPrompts = {
    'diko': `Anda adalah Diko, Asisten AI Pendidikan yang ramah dan suportif untuk siswa dan guru. Selalu gunakan bahasa yang mudah dimengerti, formal tapi bersahabat. Fokus pada materi sekolah, metode mengajar, dan administrasi pendidikan.`,
    'gladys': `Anda adalah Gladys, seorang konselor karir yang ceria dan berwawasan luas. Anda membantu calon mahasiswa memilih jurusan kuliah. Gunakan bahasa yang lebih santai dan memotivasi. Berikan informasi tentang prospek karir, perbandingan kampus, dan tips masuk universitas.`,
    'sona': `Anda adalah Sona, seorang insinyur ahli di bidang energi terbarukan dan material kelistrikan. Gaya bicara Anda teknis, to the point, dan akurat. Jelaskan konsep-konsep seperti panel surya, efisiensi energi, dan material konduktor dengan detail.`,
    'sonia': `Anda adalah Sonia, seorang technical assistant dari SONUS. Anda ahli dalam solusi energi terbarukan dari solar-nusantara.id dan material kelistrikan dari sonushub.id. Berikan jawaban yang akurat, teknis, dan informatif terkait produk dan konsep di kedua bidang tersebut.`,

    // --- KARAKTER BARU ---
    'rina': `Anda adalah Rina, seorang teman virtual yang fokus membantu pengguna memahami konsep kesehatan mental dan kepribadian seperti MBTI, Enneagram, dan lainnya. Gunakan gaya bahasa yang empatik, tenang, dan suportif. PENTING: Selalu berikan disclaimer bahwa Anda bukan psikolog atau tenaga profesional, dan sarankan pengguna untuk berkonsultasi dengan ahli jika mengalami masalah serius.`,
    'jejoo': `Anda adalah Jejoo, asisten pendamping virtual untuk guru inklusif. Gaya bicara Anda sabar, penuh pengertian, dan praktis. Anda memberikan strategi, ide kegiatan, dan solusi untuk mengajar siswa dengan beragam kebutuhan khusus (Anak Berkebutuhan Khusus). Fokus pada adaptasi kurikulum, manajemen kelas inklusif, dan cara berkomunikasi efektif dengan orang tua.`
};
const characterNames = Object.keys(characterPrompts);

async function getAIResponse(userInput, userName, characterName, imageBase64 = null) {
    const instructions = characterPrompts[characterName] || characterPrompts['diko']; // Default ke Diko
    try {
        let inputPayload;
        if (imageBase64) {
            const fullCaption = `Pengguna bernama "${userName}" mengirim gambar ini. Berikan respons sesuai dengan kepribadianmu. Pertanyaan atau caption dari pengguna adalah: "${userInput}"`;
            inputPayload = [{ role: "user", content: [{ type: "input_text", text: fullCaption }, { type: "input_image", image_url: `data:image/jpeg;base64,${imageBase64}` }] }];
        } else {
            inputPayload = userInput;
        }
        const response = await openai.responses.create({
            model: imageBase64 ? "gpt-4o" : "gpt-5-mini",
            instructions: `${instructions} Sapa pengguna bernama "${userName}".`,
            input: inputPayload,
        });
        return response.output_text + characterName + BOT_SIGNATURE;
    } catch (error) {
        console.error(`Error saat memanggil OpenAI API untuk ${characterName}:`, error);
        return `Aduh, maaf, sepertinya ada sedikit gangguan di sistem ${characterName}. 😴` + characterName + BOT_SIGNATURE;
    }
}

async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, downloadMediaMessage } = await import('@whiskeysockets/baileys');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({ logger: pino({ level: 'silent' }), printQRInTerminal: true, browser: Browsers.macOS('Desktop'), auth: state });
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if(qr) qrcode.generate(qr, { small: true });
        if(connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if(shouldReconnect) connectToWhatsApp();
        } else if(connection === 'open') console.log('Koneksi berhasil tersambung!');
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const sender = msg.key.remoteJid;
            const senderName = msg.pushName || "User";

            const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
            const imageMessage = msg.message?.imageMessage;
            const caption = imageMessage?.caption || "";

            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            const quotedMessageText = contextInfo?.quotedMessage?.conversation || contextInfo?.quotedMessage?.extendedTextMessage?.text || "";

            let characterToReply = null;
            let isTriggered = false;

            // --- LOGIKA BARU YANG DINAMIS ---

            // PRIORITAS 1: Cek balasan (reply)
            for (const name of characterNames) {
                if (quotedMessageText.endsWith(name + BOT_SIGNATURE)) {
                    console.log(`[REPLY DETECTED] Balasan untuk karakter: ${name}`);
                    const cleanQuotedText = quotedMessageText.replace(name + BOT_SIGNATURE, '');
                    const chatHistory = [{ role: "assistant", content: cleanQuotedText }, { role: "user", content: messageText }];
                    const aiReply = await getAIResponse(chatHistory, senderName, name);
                    await sock.sendMessage(sender, { text: aiReply }, { quoted: msg });
                    isTriggered = true;
                    break;
                }
            }
            
            if (isTriggered) return;

            // PRIORITAS 2 & 3: Cek kata panggilan (untuk gambar dan teks)
            const textToCheck = (imageMessage ? caption : messageText).toLowerCase();
            for (const name of characterNames) {
                if (textToCheck.includes(name)) {
                    console.log(`[KEYWORD DETECTED] Karakter dipanggil: ${name}`);
                    await sock.sendPresenceUpdate('composing', sender);
                    
                    let aiReply;
                    if (imageMessage) {
                        const imageBuffer = await downloadMediaMessage(msg, 'buffer', {});
                        const imageBase64 = imageBuffer.toString('base64');
                        aiReply = await getAIResponse(caption, senderName, name, imageBase64);
                    } else {
                        aiReply = await getAIResponse(messageText, senderName, name);
                    }
                    
                    await sock.sendMessage(sender, { text: aiReply }, { quoted: msg });
                    await sock.sendPresenceUpdate('paused', sender);
                    isTriggered = true;
                    break;
                }
            }
        }
    });
}

connectToWhatsApp();