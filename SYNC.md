# Root.ark Sync MVP

Cliente desktop/CLI minimo para enviar arquivos novos ou alterados de uma pasta local para o Root.ark.

## Comandos

```powershell
npm run sync:init
npm run sync:start
```

`sync:init` pede URL do servidor, usuario, senha, pasta local e `folderId` de destino. A senha e usada apenas para login e nao e salva. O arquivo `.rootark-sync.json` guarda URL, usuario, token, pasta local e destino.

`sync:start` monitora a pasta local, ignora arquivos sensiveis/temporarios e envia arquivos novos ou alterados para `/upload`.

## Opcoes

```powershell
npm run sync:init -- --server http://localhost:3000 --username bielx --folder C:\RootArkSync --folder-id root
npm run sync:start -- --once
npm run sync:start -- --auto-approve true
```

Use `ROOTARK_SYNC_PASSWORD` para renovar token expirado sem salvar senha:

```powershell
$env:ROOTARK_SYNC_PASSWORD="sua-senha"
npm run sync:start
```

## Estado local

O estado fica na pasta sincronizada:

```text
.rootark-sync-state.json
```

Ele registra caminho relativo, tamanho, `mtime`, hash SHA-256, status do ultimo upload e nome remoto.

## Ignorados por padrao

- `node_modules/`
- `.git/`
- `.env`
- `*.key`
- `*.pem`
- `*.tmp`
- `*.part`
- `*.crdownload`
- `*.log`
- `~$*`
- `.rootark-sync*`
- `.rootark-sync-state.json`

## Conflitos e versoes

O MVP nao sobrescreve arquivos localmente nem apaga nada. Se o arquivo ja existe no Root.ark, o cliente envia com o mesmo nome e adiciona `versionComment`; o backend atual cria nova versao quando o arquivo e aprovado.

Por padrao o arquivo fica pendente, respeitando o fluxo atual do Root.ark. Para testes/admin, `--auto-approve true` chama a rota existente `/approve/:name` apos o upload.

## Limitacoes

- Somente local para Root.ark.
- Nao baixa arquivos remotos.
- Nao sincroniza delecoes.
- Nao suporta arquivos acima de 8 MB neste MVP, porque usa a rota simples `/upload`.
- Nao e um servico de background/startup.
