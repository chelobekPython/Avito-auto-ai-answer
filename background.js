// background.js
chrome.runtime.onInstalled.addListener(() => {
    console.log('Avito AI Autoreply Extension installed');
});

// Обработка всех сообщений
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 1. Получение списка моделей Ollama
    if (request.action === "getOllamaModels") {
        fetch('http://127.0.0.1:11434/api/tags')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Ошибка Ollama API: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                const models = data.models?.map(m => m.name || m.model) || [];
                sendResponse({ success: true, models: models });
            })
            .catch(error => {
                console.error('Background Ollama Error:', error);
                sendResponse({ success: false, error: "Не удалось подключиться к Ollama. Убедитесь, что она запущена (127.0.0.1:11434)" });
            });
        return true;
    }

    // 2. Обработка запросов к AI
    if (request.action === "getAIResponse") {
        const { message, apiKey, prompt, aiProvider } = request;
        
        if (aiProvider === 'ollama') {
            // Если выбран Ollama
            fetch('http://127.0.0.1:11434/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: request.ollamaModel || 'llama3',
                    prompt: `${prompt}\n\nСообщение клиента: "${message}"`,
                    stream: false
                })
            })
            .then(async response => {
                if (!response.ok) {
                    let errorMsg = `Ollama Error ${response.status}`;
                    try {
                        const errData = await response.json();
                        errorMsg = errData.error || errorMsg;
                    } catch(e) {}
                    throw new Error(errorMsg);
                }
                return response.json();
            })
            .then(data => {
                const reply = data.response?.trim();
                if (reply) {
                    sendResponse({ success: true, reply: reply });
                } else {
                    sendResponse({ success: false, error: "Пустой ответ от Ollama" });
                }
            })
            .catch(error => {
                console.error('Background Ollama AI Error:', error);
                const msg = error.message.includes('403') 
                    ? "Ollama 403 Forbidden. Установите OLLAMA_ORIGINS=\"*\" в системных переменных и перезапустите Ollama." 
                    : error.message;
                sendResponse({ success: false, error: msg });
            });
        } else {
            // Использование Google Gemini
            fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `${prompt}\n\nСообщение клиента: "${message}"` }] }]
                })
            })
            .then(async response => {
                if (!response.ok) {
                    let errorMsg = `Gemini Error ${response.status}`;
                    try {
                        const errData = await response.json();
                        errorMsg = errData.error?.message || errorMsg;
                    } catch(e) {}
                    throw new Error(errorMsg);
                }
                return response.json();
            })
            .then(data => {
                const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                if (reply) {
                    sendResponse({ success: true, reply: reply });
                } else {
                    sendResponse({ success: false, error: "Пустой ответ от Gemini" });
                }
            })
            .catch(error => {
                console.error('Background AI Error:', error);
                sendResponse({ success: false, error: error.message });
            });
        }

        return true; // Важно для асинхронного sendResponse
    }

    // 3. Слушатель для сохранения настроек
    if (request.action === 'saveSettings') {
        chrome.storage.sync.set({ 
            apiKey: request.apiKey, 
            aiPrompt: request.aiPrompt,
            aiProvider: request.aiProvider,
            ollamaModel: request.ollamaModel
        }, () => {
            sendResponse({ status: 'success' });
        });
        return true;
    }
});
