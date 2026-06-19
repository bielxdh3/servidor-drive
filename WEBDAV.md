# Root.ark WebDAV MVP

Este recurso expõe os arquivos do Root.ark em um endpoint WebDAV mínimo para montagem como pasta de rede.

## Como ativar

Defina as variáveis de ambiente antes de iniciar o servidor:

```powershell
$env:WEBDAV_ENABLED="true"
$env:WEBDAV_PATH="/dav"
node server.js
```

Com `npm start`, use as mesmas variáveis antes do comando.

## Variáveis

- `WEBDAV_ENABLED=false`: ativa ou desativa o WebDAV.
- `WEBDAV_PATH=/dav`: caminho público do WebDAV.
- `WEBDAV_ALLOW_DELETE=false`: reservado; DELETE permanece bloqueado no MVP.
- `WEBDAV_ALLOW_MOVE=false`: reservado; MOVE permanece bloqueado no MVP.

## Endpoint

- URL local: `http://localhost:3000/dav`
- URL pública: `https://seu-dominio/dav`

## Autenticação

O MVP usa Basic Auth com os mesmos usuários e senhas do Root.ark.

Não use token JWT na URL. WebDAV anônimo não é permitido.
Em produção, use HTTPS para proteger usuário e senha durante a conexão.

## Operações suportadas

- `OPTIONS`: informa capacidades WebDAV.
- `PROPFIND`: lista pastas e arquivos acessíveis ao usuário.
- `GET`/`HEAD`: baixa arquivos acessíveis.
- `PUT`: envia arquivo para a pasta alvo como upload pendente de aprovação.
- `MKCOL`: cria uma pasta de nível principal, se o usuário tiver permissão de criar pastas.

## Operações não suportadas no MVP

- `DELETE`: bloqueado por segurança. A deleção WebDAV deve integrar com a Lixeira antes de ser liberada.
- `MOVE`: bloqueado por segurança. Renomear/mover por WebDAV fica para uma etapa posterior.
- `LOCK`/`UNLOCK`: retorna não suportado. O MVP não finge lock para evitar corrupção.
- Arquivos criptografados: não são listados nem baixados via WebDAV neste MVP, porque alguns exigem senha/interação.
- Pastas aninhadas: o Root.ark trabalha com pastas lógicas de primeiro nível; MKCOL aninhado retorna erro.

## Windows

No Explorer, use “Mapear unidade de rede” e informe:

```txt
https://seu-dominio/dav
```

Entre com usuário e senha do Root.ark.

## Linux/macOS

Clientes WebDAV comuns funcionam com Basic Auth, por exemplo `davfs2`, gerenciadores de arquivos GNOME/KDE ou Finder.

## Segurança

- Caminhos são virtuais e normalizados.
- `../`, barras invertidas e caminhos absolutos são rejeitados.
- O servidor nunca expõe caminhos reais do disco.
- Arquivos na Lixeira, expirados, versões internas e arquivos sem permissão não aparecem.
- Uploads via PUT entram como pendentes de aprovação, mantendo o fluxo normal do Root.ark.

## Testes rápidos

```powershell
curl.exe -i -X PROPFIND http://localhost:3000/dav
curl.exe -i -u admin:admin123 -X PROPFIND http://localhost:3000/dav
curl.exe -i -u admin:admin123 -T .\teste.txt http://localhost:3000/dav/teste.txt
curl.exe -i -u admin:admin123 -X MKCOL http://localhost:3000/dav/NovaPastaWebDAV
curl.exe -i -u admin:admin123 -X DELETE http://localhost:3000/dav/teste.txt
```

O `DELETE` deve retornar bloqueado no MVP.
