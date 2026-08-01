# Backups do Root.ark

O sistema de backup protege metadados, banco SQLite local e arquivos enviados sem incluir segredos.

## Local

Backups, o lock, o histÃ³rico JSON e os temporÃ¡rios de restore ficam no diretÃ³rio de runtime do processo:

```text
<runtime-root>/data/backups
```

Formato:

```text
rootark-backup-YYYY-MM-DD-HH-mm-ss.zip
rootark-pre-restore-YYYY-MM-DD-HH-mm-ss.zip
```

Cada arquivo inclui `backup-manifest.json`.

## Variáveis

```env
BACKUP_ENABLED=true
BACKUP_AUTO_ENABLED=true
BACKUP_TIME=03:00
BACKUP_RETENTION_DAYS=30
BACKUP_RETENTION_COUNT=10
BACKUP_INCLUDE_UPLOADS=true
BACKUP_INCLUDE_TEMP=false
BACKUP_COMPRESS=true
```

## O que entra

- O banco SQLite configurado por `DATABASE_URL`, com `-wal` e `-shm` quando existirem; ele Ã© restaurado no mesmo caminho configurado.
- JSON antigos em `<runtime-root>/data/*.json`, se existirem.
- `<runtime-root>/uploads`, se `BACKUP_INCLUDE_UPLOADS=true`.
- metadados importantes em `<runtime-root>/data`.

## O que não entra

- `node_modules`
- `.git`
- `.env`
- credenciais AWS/GDrive
- arquivos `.key`, `.pem`, `.p12`
- `data/server-master.key`
- `data/backups`
- uploads temporários incompletos em `temp/.chunks` e `temp/.incoming`

## Backup manual

Pelo painel:

```text
Admin > Backups > Criar backup agora
```

Ou pela API:

```http
POST /backups
```

Requer admin, `manageUsers` ou `manageBackups`.

## Backup automático

Se `BACKUP_AUTO_ENABLED=true`, o servidor cria um backup diário no horário de `BACKUP_TIME`.

O último erro aparece no painel de backups via:

```http
GET /backups/latest-status
```

## Restore

Pelo painel:

1. Abra `Backups`.
2. Clique em `Restaurar`.
3. Confirme o aviso.
4. Digite exatamente `RESTORE`.

Antes da restauração, o servidor cria um backup `pre-restore`.

O restore:

- valida o ZIP;
- valida `backup-manifest.json`;
- verifica checksum quando disponível;
- bloqueia path traversal;
- rejeita paths absolutos e symlinks;
- extrai em `<runtime-root>/data/backups/.restore-tmp`;
- restaura JSON em `<runtime-root>/data` e uploads em `<runtime-root>/uploads`;
- limpa temporários.

Se o backup tiver SQLite, reinicie o servidor após restaurar para garantir que o banco recarregue limpo.

## Auditoria

Eventos registrados:

- `backup.created`
- `backup.failed`
- `backup.deleted`
- `backup.downloaded`
- `backup.restore.started`
- `backup.restore.completed`
- `backup.restore.failed`

## Recuperação manual

Se necessário:

1. Pare o servidor.
2. Extraia um backup em uma pasta separada.
3. Copie `data/rootark.sqlite*` para `./data`.
4. Copie `uploads` para `./uploads`.
5. Reinicie o servidor.

Não restaure `server-master.key` via backup, pois chaves privadas não são incluídas.
