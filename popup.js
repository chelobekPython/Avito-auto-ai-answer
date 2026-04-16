// popup.js
document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const aiProviderSelect = document.getElementById('aiProvider');
    const ollamaModelSelect = document.getElementById('ollamaModel');
    const refreshModelsBtn = document.getElementById('refreshModels');
    const promptInput = document.getElementById('prompt');
    const saveButton = document.getElementById('save');
    const status = document.getElementById('status');
    const toggleBot = document.getElementById('toggleBot');
    const tabList = document.getElementById('tabList');
    const historyList = document.getElementById('history');

    // 1. Загрузка настроек
    chrome.storage.sync.get(['apiKey', 'aiPrompt', 'botRunning', 'history', 'aiProvider', 'ollamaModel'], (items) => {
        if (items.aiProvider) {
            aiProviderSelect.value = items.aiProvider;
            if (items.aiProvider === 'ollama') {
                document.getElementById('geminiSettings').style.display = 'none';
                document.getElementById('ollamaSettings').style.display = 'block';
            }
        }
        if (items.apiKey) apiKeyInput.value = items.apiKey;
        if (items.aiPrompt) promptInput.value = items.aiPrompt;
        
        // Предварительно заполняем модель, если она есть
        if (items.ollamaModel) {
            const option = document.createElement('option');
            option.value = items.ollamaModel;
            option.textContent = items.ollamaModel;
            ollamaModelSelect.appendChild(option);
            ollamaModelSelect.value = items.ollamaModel;
        }

        updateBotButton(items.botRunning);
        updateHistoryUI(items.history || []);
    });

    // 2. Поиск вкладок Avito
    chrome.tabs.query({url: "https://www.avito.ru/*"}, (tabs) => {
        if (tabs.length === 0) {
            tabList.innerHTML = '<div class="tab-item" style="color: #999;">Вкладки Avito не найдены</div>';
            return;
        }
        tabList.innerHTML = '';
        tabs.forEach(tab => {
            const div = document.createElement('div');
            div.className = 'tab-item';
            div.textContent = tab.title || tab.url;
            div.onclick = () => {
                chrome.tabs.update(tab.id, {active: true});
                chrome.windows.update(tab.windowId, {focused: true});
            };
            tabList.appendChild(div);
        });
    });

    // 3. Сохранение настроек
    function saveAllSettings(quiet = false) {
        const aiProvider = aiProviderSelect.value;
        const ollamaModel = ollamaModelSelect.value;
        const apiKey = apiKeyInput.value.trim();
        const aiPrompt = promptInput.value.trim();

        chrome.storage.sync.set({ apiKey, aiPrompt, aiProvider, ollamaModel }, () => {
            if (!quiet) showStatus('Настройки сохранены!');
            
            // Уведомляем вкладки об обновлении настроек
            chrome.tabs.query({url: "https://www.avito.ru/*"}, (tabs) => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, { 
                        action: "settingsUpdated",
                        settings: { aiProvider, ollamaModel, apiKey, aiPrompt }
                    }).catch(() => {}); // Игнорируем ошибки если вкладка не готова
                });
            });
        });
    }

    saveButton.addEventListener('click', () => saveAllSettings());

    // 4. Переключатель бота
    toggleBot.addEventListener('click', () => {
        // При запуске сначала сохраняем текущие выбранные значения
        saveAllSettings(true);
        
        const aiProvider = aiProviderSelect.value;
        chrome.storage.sync.get(['botRunning'], (items) => {
            const newState = !items.botRunning;
            chrome.storage.sync.set({ botRunning: newState }, () => {
                updateBotButton(newState);
                showStatus(newState ? 'Бот запущен' : 'Бот остановлен');

                // Уведомляем вкладки об изменении состояния
                chrome.tabs.query({url: "https://www.avito.ru/*"}, (tabs) => {
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, { 
                            action: "updateState", 
                            running: newState,
                            aiProvider: aiProvider
                        }).catch(() => {});
                    });
                });
            });
        });
    });

    function updateBotButton(isRunning) {
        const aiProvider = aiProviderSelect.value;
        if (isRunning) {
            if (aiProvider === 'ollama') {
                toggleBot.textContent = 'Стоп (Ollama)';
            } else {
                toggleBot.textContent = 'Стоп';
            }
        } else {
            if (aiProvider === 'ollama') {
                toggleBot.textContent = 'Запуск (Ollama)';
            } else {
                toggleBot.textContent = 'Запуск';
            }
        }
    }

    function updateHistoryUI(history) {
        if (history.length === 0) return;
        historyList.innerHTML = '';
        history.slice(-10).reverse().forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <div class="history-time">${new Date(item.time).toLocaleTimeString()}</div>
                <div style="font-weight:bold; margin-top:2px;">Вх: ${item.userMsg.substring(0, 30)}...</div>
                <div style="color:#00aff0; margin-top:2px;">Бот: ${item.aiReply.substring(0, 50)}...</div>
            `;
            historyList.appendChild(div);
        });
    }

    function showStatus(text) {
        status.textContent = text;
        setTimeout(() => status.textContent = '', 2000);
    }

    // Обновление настроек провайдера
    aiProviderSelect.addEventListener('change', () => {
        const selectedProvider = aiProviderSelect.value;
        if (selectedProvider === 'ollama') {
            document.getElementById('geminiSettings').style.display = 'none';
            document.getElementById('ollamaSettings').style.display = 'block';
            refreshOllamaModels();
        } else {
            document.getElementById('geminiSettings').style.display = 'block';
            document.getElementById('ollamaSettings').style.display = 'none';
        }
        saveAllSettings(true); // Авто-сохранение при смене провайдера
    });

    ollamaModelSelect.addEventListener('change', () => {
        saveAllSettings(true); // Авто-сохранение при смене модели
    });

    // Обновление списка моделей Ollama
    function refreshOllamaModels() {
        chrome.runtime.sendMessage({ action: "getOllamaModels" }, (response) => {
            if (response && response.success) {
                ollamaModelSelect.innerHTML = '';
                response.models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model;
                    option.textContent = model;
                    ollamaModelSelect.appendChild(option);
                });
                showStatus('Модели Ollama обновлены');
            } else {
                showStatus('Ошибка при получении моделей: ' + (response?.error || 'Неизвестная ошибка'));
            }
        });
    }

    // Обновление списка моделей при загрузке
    chrome.storage.sync.get(['aiProvider'], (items) => {
        if (items.aiProvider === 'ollama') {
            refreshOllamaModels();
        }
    });

    // Кнопка обновления моделей
    refreshModelsBtn.addEventListener('click', refreshOllamaModels);
});