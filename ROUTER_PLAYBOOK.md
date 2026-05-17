# ROUTER_PLAYBOOK.md

## RouterOps Playbook

## Цель
Стандартизировать подключение к роутерам, диагностику, изменения и откат без простоя.

## Обязательные входные данные перед подключением
- Вендор/модель/OS (MikroTik RouterOS, Cisco IOS/IOS-XE, etc.)
- IP/hostname, порт управления (SSH/HTTPS/Winbox/API)
- Учётка с нужными правами (минимально необходимыми)
- Окно изменений и допустимый риск
- План отката

## Правила безопасности
- Никогда не печатать пароли, токены, приватные ключи и cookie в отчётах.
- Перед изменениями всегда сделать backup/export текущей конфигурации.
- Изменения делать поэтапно: одна логическая группа за раз.
- После каждого шага валидировать связность/доступность.
- Деструктивные операции (drop/reset/remove) только после явного подтверждения.

## Универсальный workflow
1. Pre-check: пинг/доступ к mgmt-интерфейсу, проверка прав.
2. Снять baseline: версия ОС, интерфейсы, маршруты, NAT, firewall, VPN.
3. Сохранить backup/export.
4. Подготовить change-set (команды + ожидаемый результат).
5. Применить минимальный change-set.
6. Post-check: доступ, маршрутизация, сервисы, логи ошибок.
7. Зафиксировать изменения и артефакты.

## MikroTik (RouterOS) - минимальный чеклист
- Baseline:
  - `/system resource print`
  - `/system package print`
  - `/interface print`
  - `/ip address print`
  - `/ip route print detail`
  - `/ip firewall filter print`
  - `/ip firewall nat print`
- Backup:
  - `/export file=pre_change_export`
  - `/system backup save name=pre_change_backup`
- Post-check:
  - `/log print where topics~"error|warning"`
  - `ping` ключевых хостов/шлюзов

## Cisco IOS/IOS-XE - минимальный чеклист
- Baseline:
  - `show version`
  - `show ip interface brief`
  - `show running-config`
  - `show ip route`
  - `show access-lists`
  - `show logging | include %`
- Backup:
  - `copy running-config startup-config`
  - при возможности экспорт конфига на внешний сервер
- Post-check:
  - `show ip route`
  - `show interfaces status`
  - `show logging | include %`

## Шаблон отчёта по роутер-задаче
1. Цель изменения
2. Что проверено до изменений
3. Какие команды применены
4. Что проверено после
5. Риски/что мониторить
6. План отката

## Практика подключения с этого ПК (проверено)
- Доступный роутер: `192.168.5.1`
- SSH: открыт (`22/tcp`)
- Типовая ошибка при первом входе через PuTTY/plink: `host key is not cached`.

### Рабочая команда (plink)
```powershell
& 'C:\Program Files\PuTTY\plink.exe' -batch -ssh -P 22 -l codex -pw '<PASSWORD>' -hostkey 'ssh-rsa 2048 SHA256:cTPHS/DQmoPB75W/j2yNBfmmaBiGNYdNwuQeVRXasfE' 192.168.5.1 "/system identity print; /system resource print"
```

### Автоматизированный запуск через скрипт
```powershell
$env:MIKROTIK_PASSWORD='<PASSWORD>'
& 'C:\Codex\Общий\scripts\mikrotik_run.ps1' -Host 192.168.5.1 -User codex -HostKey 'ssh-rsa 2048 SHA256:cTPHS/DQmoPB75W/j2yNBfmmaBiGNYdNwuQeVRXasfE'
```
