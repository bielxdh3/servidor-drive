# Root.ark Trash

Root.ark agora usa uma lixeira segura para arquivos e pastas. A exclusao comum nao destrói o item imediatamente: ele sai das listas normais e fica disponivel para restauracao ou exclusao definitiva.

## Como Funciona

- Arquivos excluidos sao movidos para `data/trash/files/<id>/`.
- Pastas excluidas sao movidas para `data/trash/folders/<id>/`.
- Os metadados ficam registrados em SQLite na tabela `trash_items` quando `DB_ENABLED=true`.
- Se SQLite nao estiver ativo, o fallback usa `data/trash-items.json`.
- Os caminhos fisicos e o fallback JSON resolvem a partir do diretorio de trabalho do servidor em execucao: `data/trash/` e `data/trash-items.json` pertencem ao mesmo runtime que `uploads/` e `temp/`.
- Permissoes, expiracoes, versoes e metadados de criptografia sao preservados para restauracao quando possivel.
- Links publicos de itens movidos para a lixeira deixam de funcionar e nao sao reativados automaticamente na restauracao.

## Permissoes

- Quem pode excluir arquivos/pastas continua seguindo as permissoes atuais de edicao/exclusao.
- Admins e usuarios com `manageTrash` podem excluir definitivamente e esvaziar a lixeira.
- Admins e usuarios com `manageTrash` podem restaurar qualquer item.
- Usuarios comuns podem restaurar arquivos que eles mesmos excluiram, desde que ainda tenham acesso a pasta original, e pastas que eles mesmos moveram para a lixeira.

## Rotas

- `GET /trash`: lista itens da lixeira visiveis para o usuario.
- `GET /trash/summary`: retorna quantidade e tamanho total.
- `POST /trash/:id/restore`: restaura item.
- `DELETE /trash/:id`: exclui definitivamente, exige admin ou `manageTrash`.
- `DELETE /trash`: esvazia a lixeira, exige confirmacao `{ "confirmation": "DELETE" }`.

## Variaveis de Ambiente

- `TRASH_ENABLED=true`: reservado para controlar o recurso.
- `TRASH_AUTO_CLEANUP_ENABLED=false`: ativa limpeza automatica.
- `TRASH_RETENTION_DAYS=30`: idade minima para limpeza automatica.

## Restauracao

Se o arquivo restaurado ja existir no destino, o Root.ark usa um nome seguro como `arquivo (restored).ext` ou `arquivo (restored 2).ext`.

Se uma pasta for restaurada e o mesmo id ja existir, ela volta com um id/nome alternativo para evitar sobrescrever dados existentes.

## Exclusao Definitiva

A exclusao definitiva remove o conteudo fisico guardado na lixeira e marca o item como `permanently_deleted` no historico da lixeira. Versoes fisicas associadas sao removidas quando possivel.

## Auditoria

Eventos registrados:

- `trash.file.moved`
- `trash.folder.moved`
- `trash.file.restored`
- `trash.folder.restored`
- `trash.file.permanently_deleted`
- `trash.folder.permanently_deleted`
- `trash.emptied`
- `trash.restore.failed`
- `trash.delete.failed`

## Testes Recomendados

A regressao local inicia servidores com diretorios de trabalho descartaveis e cobre arquivos e pastas, visibilidade, restauracao pelo autor, exclusao definitiva por `manageTrash`, esvaziamento parcial seguro, caminhos adulterados e limpeza automatica por retencao. Os testes preservam sentinelas externas e confirmam que o checkout do modulo nao recebe artefatos. Exclusao em lixeiras de provedores cloud continua fora desta cobertura.

1. Excluir um arquivo e confirmar que ele desaparece da lista normal.
2. Abrir a aba Lixeira e confirmar que o arquivo aparece.
3. Restaurar o arquivo e confirmar que ele volta para a pasta original.
4. Excluir uma pasta e confirmar que ela aparece na Lixeira.
5. Restaurar a pasta.
6. Excluir definitivamente um item como admin.
7. Tentar exclusao definitiva com usuario comum sem `manageTrash` e confirmar 403.
8. Confirmar que download/preview/link publico de item na lixeira retorna bloqueio.
9. Reiniciar o servidor e confirmar que a lixeira continua preservada.
