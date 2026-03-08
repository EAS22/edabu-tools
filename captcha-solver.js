// captcha-solver.js — CAPTCHA solver dengan FAILOVER otomatis
// Provider: OpenRouter ↔ Groq (jika satu gagal, otomatis coba yang lain)

const PROMPT = 'Read the CAPTCHA text in this image. The text contains EXACTLY 5 characters, using uppercase letters and digits only. Reply with ONLY the 5-character captcha text, nothing else. No explanation, no quotes, no punctuation.';

// ==================== OPENROUTER ====================
const OPENROUTER_MODELS = [
    'google/gemini-2.5-flash',
    'google/gemini-2.0-flash-lite-preview-02-05:free',
    'meta-llama/llama-3.2-11b-vision-instruct:free',
];

async function solveWithOpenRouter(base64Data, mimeType, apiKey) {
    if (!apiKey) throw new Error('OpenRouter API key belum diset.');
    
    const dataUri = `data:${mimeType};base64,${base64Data}`;

    for (const modelName of OPENROUTER_MODELS) {
        try {
            console.log(`[Captcha Solver] OpenRouter → ${modelName}...`);
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://edabu-tools.local',
                    'X-Title': 'Edabu Tools',
                },
                body: JSON.stringify({
                    model: modelName,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: dataUri } },
                            { type: 'text', text: PROMPT },
                        ],
                    }],
                    max_tokens: 20,
                    temperature: 0,
                }),
            });

            if (!res.ok) {
                const errBody = await res.text();
                throw new Error(`HTTP ${res.status}: ${errBody.substring(0, 100)}`);
            }

            const json = await res.json();
            const raw = json.choices?.[0]?.message?.content?.trim() || '';
            const text = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            console.log(`[Captcha Solver] OpenRouter ${modelName}: "${raw}" → "${text}"`);
            if (text.length === 5) return { text, provider: 'OpenRouter', model: modelName };
        } catch (err) {
            console.log(`[Captcha Solver] OpenRouter ${modelName} gagal:`, err.message?.substring(0, 80));
        }
    }
    throw new Error('Semua model OpenRouter gagal.');
}

// ==================== GROQ ====================
const GROQ_MODELS = [
    'llama-3.2-11b-vision-preview',
    'llama-3.2-90b-vision-preview',
];

async function solveWithGroq(base64Data, mimeType, apiKey) {
    if (!apiKey) throw new Error('Groq API key belum diset.');
    
    const dataUri = `data:${mimeType};base64,${base64Data}`;

    for (const modelName of GROQ_MODELS) {
        try {
            console.log(`[Captcha Solver] Groq → ${modelName}...`);
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: modelName,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: dataUri } },
                            { type: 'text', text: PROMPT },
                        ],
                    }],
                    max_tokens: 20,
                    temperature: 0,
                }),
            });

            if (!res.ok) {
                const errBody = await res.text();
                throw new Error(`HTTP ${res.status}: ${errBody.substring(0, 100)}`);
            }

            const json = await res.json();
            const raw = json.choices?.[0]?.message?.content?.trim() || '';
            const text = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            console.log(`[Captcha Solver] Groq ${modelName}: "${raw}" → "${text}"`);
            if (text.length === 5) return { text, provider: 'Groq', model: modelName };
        } catch (err) {
            console.log(`[Captcha Solver] Groq ${modelName} gagal:`, err.message?.substring(0, 80));
        }
    }
    throw new Error('Semua model Groq gagal.');
}

// ==================== FAILOVER MAIN ====================
/**
 * Solve CAPTCHA dengan failover otomatis antara OpenRouter dan Groq
 * Prioritas: OpenRouter dulu (free), jika gagal → Groq
 * @param {string} imageBase64 - data:image/png;base64,... atau raw base64
 * @param {string} openrouterKey - API key OpenRouter
 * @param {string} groqKey - API key Groq
 * @returns {Promise<{text: string, provider: string, model: string}>}
 */
async function solveCaptchaImage(imageBase64, openrouterKey, groqKey) {
    let base64Data = imageBase64;
    let mimeType = 'image/png';
    if (imageBase64.startsWith('data:')) {
        const parts = imageBase64.split(',');
        base64Data = parts[1];
        const mimeMatch = parts[0].match(/data:(.*?);/);
        if (mimeMatch) mimeType = mimeMatch[1];
    }

    const errors = [];

    // Prioritas 1: OpenRouter (Gemini 2.5 Flash terlebih dahulu)
    if (openrouterKey) {
        try {
            const result = await solveWithOpenRouter(base64Data, mimeType, openrouterKey);
            if (result) return result;
        } catch (err) {
            errors.push(`OpenRouter: ${err.message}`);
        }
    }

    // Prioritas 2: Groq (fallback)
    if (groqKey) {
        try {
            const result = await solveWithGroq(base64Data, mimeType, groqKey);
            if (result) return result;
        } catch (err) {
            errors.push(`Groq: ${err.message}`);
        }
    }

    // Jika semua gagal
    if (errors.length === 0) {
        throw new Error('Tidak ada API key yang terkonfigurasi.');
    }
    throw new Error('Semua provider gagal: ' + errors.join(' | '));
}

module.exports = { solveCaptchaImage };
