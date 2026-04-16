// content.js - Бот для автоответов Авито
let lastProcessedMessage = '';
let isRunning = false;
let widgetElement = null;
let msgCounter = 0;

// Функция проверки валидности контекста (защита от ошибок после обновления расширения)
function isContextValid() {
    return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
}

// Функция для логирования
function logAction(message) {
    if (!isContextValid()) return;
    const timestamp = new Date().toLocaleTimeString();
    const logMsg = `[${timestamp}] ${message}`;
    console.log(`%cAvito AI:%c ${logMsg}`, "color: #00AAFF; font-weight: bold", "color: inherit");
    
    try {
        chrome.storage.local.get(['logs'], (data) => {
            if (!isContextValid()) return;
            const logs = data.logs || [];
            logs.push(logMsg);
            chrome.storage.local.set({ logs: logs.slice(-30) });
            updateWidgetLogs();
        });
    } catch (e) {
        console.log("Контекст расширения потерян. Нужно обновить страницу.");
    }
}

// Загружаем начальное состояние
if (isContextValid()) {
    chrome.storage.sync.get(['botRunning', 'msgCounter'], (items) => {
        if (!isContextValid()) return;
        isRunning = !!items.botRunning;
        msgCounter = items.msgCounter || 0;
        updateWidgetUI();
    });

    // Слушаем команды от popup
    chrome.runtime.onMessage.addListener((request) => {
        if (!isContextValid()) return;
        if (request.action === "updateState") {
            isRunning = request.running;
            logAction(`Статус: ${isRunning ? 'ЗАПУЩЕН' : 'ОСТАНОВЛЕН'}`);
            updateWidgetUI();
        }
    });
}

function saveToHistory(userMsg, aiReply) {
    if (!isContextValid()) return;
    chrome.storage.sync.get(['history'], (items) => {
        if (!isContextValid()) return;
        const history = items.history || [];
        history.push({ time: Date.now(), userMsg, aiReply });
        chrome.storage.sync.set({ history: history.slice(-50) });
    });
}

const observer = new MutationObserver(() => {
    if (!isRunning || !isContextValid()) return;

    const messageTexts = document.querySelectorAll('[data-marker="messageText"]');
    if (messageTexts.length > 0) {
        const lastTextNode = messageTexts[messageTexts.length - 1];
        const text = lastTextNode.innerText?.trim() || '';
        if (!text) return;

        const container = lastTextNode.closest('[class*="message-base-module-content"]') || lastTextNode.parentElement;
        
        const isOutcoming = 
            container.innerHTML.includes('self') || 
            container.innerHTML.includes('is-out') ||
            !!container.querySelector('[data-marker="messageStatus"]') || 
            !!container.querySelector('svg[class*="Status"]') ||
            lastTextNode.closest('[class*="_self"]') ||
            lastTextNode.closest('[class*="_out"]') ||
            lastTextNode.className.includes('_right') || 
            container.className.includes('_right');

        if (text !== lastProcessedMessage) {
            if (isOutcoming) {
                lastProcessedMessage = text;
                return;
            }
            lastProcessedMessage = text;
            handleNewMessage(text);
        }
    }
});

observer.observe(document.body, { childList: true, subtree: true });

async function handleNewMessage(userMessage) {
    if (!isContextValid()) return;
    logAction(`Новое сообщение: "${userMessage.substring(0, 20)}..."`);
    
    chrome.storage.sync.get(['apiKey', 'aiPrompt', 'aiProvider', 'ollamaModel'], (settings) => {
        if (!isContextValid()) return;
        
        const aiProvider = settings.aiProvider || 'gemini';
        logAction(`Использую провайдер: ${aiProvider}`);
        
        // Проверяем необходимые настройки в зависимости от провайдера
        if (aiProvider === 'gemini' && !settings.apiKey) {
            logAction("ОШИБКА: Не указан API Key для Gemini!");
            return;
        }
        
        if (aiProvider === 'ollama' && (!settings.ollamaModel || settings.ollamaModel === '')) {
            logAction("ОШИБКА: Не выбрана модель Ollama!");
            return;
        }

        logAction(`Запрос к ${aiProvider.toUpperCase()}...`);
        const prompt = settings.aiPrompt || 'Ты продавец на Avito. Ответь кратко:';

        const messageObj = {
            action: "getAIResponse",
            message: userMessage,
            apiKey: settings.apiKey,
            prompt: prompt,
            aiProvider: aiProvider
        };
        
        // Добавляем модель Ollama если выбран этот провайдер
        if (aiProvider === 'ollama') {
            messageObj.ollamaModel = settings.ollamaModel;
        }

        chrome.runtime.sendMessage(messageObj, (response) => {
            if (!isContextValid()) return;
            if (response && response.success) {
                injectReply(response.reply, userMessage);
            } else {
                logAction(`ОШИБКА API: ${response?.error || 'Нет ответа'}`);
            }
        });
    });
}

function injectReply(aiReply, userMessage) {
    const inputField = 
        document.querySelector('textarea[data-marker="reply/input"]') ||
        document.querySelector('textarea[data-marker="message-input"]') ||
        document.querySelector('textarea[placeholder*="Напишите"]') ||
        document.querySelector('textarea[placeholder*="Сообщение"]') ||
        document.querySelector('[data-testid="message-input"] textarea');
    
    if (inputField) {
        inputField.focus();
        inputField.value = aiReply;
        
        try {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
            if (setter) setter.call(inputField, aiReply);
        } catch(e) {}
        
        inputField.dispatchEvent(new Event('input', { bubbles: true }));
        
        msgCounter++;
        if (isContextValid()) {
            chrome.storage.sync.set({ msgCounter });
            logAction(`Ответ вставлен (${msgCounter})`);
            updateWidgetUI();
            saveToHistory(userMessage, aiReply);

            // Автоматическая отправка сообщения
            setTimeout(() => {
                const sendButton = 
                    document.querySelector('[data-marker="reply/send"]') || 
                    document.querySelector('[data-marker="message-submit"]') ||
                    document.querySelector('button[class*="send-button"]');
                
                if (sendButton) {
                    sendButton.click();
                    logAction("Сообщение отправлено автоматически");
                } else {
                    logAction("Кнопка отправки не найдена");
                }
            }, 500); // Небольшая задержка для уверенности, что текст зафиксирован
        }
    } else {
        logAction("ОШИБКА: Поле ввода не найдено");
    }
}

function injectWidget() {
    if (widgetElement) return;
    widgetElement = document.createElement('div');
    widgetElement.id = 'avito-ai-widget';
    widgetElement.innerHTML = `
        <div style="background:#00AAFF;color:#fff;padding:8px;display:flex;justify-content:space-between;align-items:center;font-weight:bold;font-size:12px;border-radius:8px 8px 0 0">
            <span>Avito AI <span id="avito-msg-count"></span></span>
            <button id="avito-ai-toggle-btn" style="cursor:pointer;border:none;padding:2px 8px;border-radius:4px;font-size:11px"></button>
        </div>
        <div id="avito-ai-widget-logs" style="max-height:120px;overflow-y:auto;padding:6px;font-size:10px;background:#fff;color:#333"></div>
    `;

    Object.assign(widgetElement.style, {
        position: 'fixed', bottom: '20px', right: '20px', width: '220px',
        zIndex: '10000', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        fontFamily: 'sans-serif', border: '1px solid #00AAFF'
    });

    document.body.appendChild(widgetElement);
    document.getElementById('avito-ai-toggle-btn').onclick = () => {
        if (!isContextValid()) {
            alert("Расширение было обновлено. Пожалуйста, перезагрузите страницу Авито.");
            return;
        }
        isRunning = !isRunning;
        chrome.storage.sync.set({ botRunning: isRunning });
        updateWidgetUI();
        chrome.runtime.sendMessage({ action: "updateState", running: isRunning });
    };
    updateWidgetUI();
    updateWidgetLogs();
}

function updateWidgetUI() {
    if (!widgetElement) return;
    const btn = document.getElementById('avito-ai-toggle-btn');
    btn.innerText = isRunning ? 'СТОП' : 'ПУСК';
    btn.style.background = isRunning ? '#ff4b4b' : '#fff';
    btn.style.color = isRunning ? '#fff' : '#00AAFF';
    const countEl = document.getElementById('avito-msg-count');
    if (countEl) countEl.innerText = `(${msgCounter})`;
}

function updateWidgetLogs() {
    if (!widgetElement || !isContextValid()) return;
    chrome.storage.local.get(['logs'], (data) => {
        if (!isContextValid()) return;
        const logs = data.logs || [];
        const logsContainer = document.getElementById('avito-ai-widget-logs');
        if (logsContainer) {
            logsContainer.innerHTML = 
                logs.slice(-10).reverse().map(l => `<div style="margin-bottom:2px;border-bottom:1px solid #eee">${l}</div>`).join('');
        }
    });
}

if (window.location.href.includes('/messenger/channel/')) {
    injectWidget();
}