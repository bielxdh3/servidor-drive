# Pasta `data/`

Esta pasta guarda estado local do servidor e nao deve versionar dados reais.

## Nao enviar para o GitHub

- `users.json` e `users.local.json`: contas, roles, permissoes e hashes de senha.
- `folders.json`: estrutura real de pastas e usuarios permitidos.
- `pending-uploads.json`: fila local de uploads pendentes.
- `public-links.json`: tokens e expiracoes de links publicos.
- `actions-history.json`: historico de acoes com nomes de arquivos e usuarios.
- `analytics.json`, `audit-logs.json` e `audit-logs-archive.json`: logs, IPs, user-agents e rastros de uso.
- `file-permissions.json`, `file-expirations.json` e `file-versions.json`: permissoes, expiracoes e historico local de arquivos.
- `encrypted-files.json` e `server-master.key`: metadados/chave de criptografia.
- `rootark.sqlite`, `rootark.sqlite-wal`, `rootark.sqlite-shm`: banco SQLite local e arquivos auxiliares.
- `backups/`: backups locais de JSON e SQLite.

## O que pode ir para o GitHub

- Este `README.md`.
- Arquivos `.example` ou templates sem dados reais, tokens, hashes, chaves, IPs ou nomes de usuarios reais.

O `server.js` cria os arquivos necessarios automaticamente na primeira execucao quando eles nao existem.
