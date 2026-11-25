# Antigravity Fast Switch

Локальный патч `app.asar` для быстрого переключения Google-аккаунтов прямо из левого сайдбара Antigravity (кнопка `Fast switch` над `Settings` с адаптивным поповером под текущую тему).

## Возможности
- Сохраняет несколько учётных записей Google и отображает активную и сохранённые в поповере.
- Хранит токены изолированно в Windows Credential Manager (`gemini:antigravity:fastswitch:*`).
- При переключении подменяет активную запись (`gemini:antigravity`) и перезапускает `language_server` без полного перезапуска IDE.
- Делает резервную копию `app.asar.fast-switch.backup` перед патчингом и проверяет SHA-256 целостность + `node --check`.

## Зависимости
- Windows 10/11
- Python 3
- Node.js (для проверки синтаксиса `node --check`)

## Установка
```powershell
git clone https://github.com/Parfnx/antigravity-fast-switch.git
cd antigravity-fast-switch
.\apply.ps1
```

## Откат
```powershell
.\unpatch.ps1
```

## Примечание
После автообновления Antigravity `app.asar` перезаписывается — перед обновлением можно откатить патч, а после обновления снова запустить `.\apply.ps1`.
