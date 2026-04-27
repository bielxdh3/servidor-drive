# Root.ark - Criptografia de arquivos

## Chave mestra

Arquivos com `server-key`, `user-key` e parte da criptografia `dual` dependem da chave mestra do servidor.

Prioridade de leitura:

1. Variavel de ambiente `SERVER_MASTER_KEY` com 32 bytes em hex ou base64.
2. Arquivo local `data/server-master.key`, gerado automaticamente se a variavel nao existir.

Faca backup seguro de `SERVER_MASTER_KEY` ou `data/server-master.key`. Se essa chave for perdida, arquivos criptografados com chave do servidor ou usuario nao poderao ser recuperados.

## Senhas de arquivo

Arquivos com nivel `password` ou `dual` exigem a senha no download. A senha nao e salva em plaintext. Se a senha for perdida, o conteudo pode se tornar irrecuperavel.

## Limites de seguranca

- Arquivos criptografados nao possuem preview.
- Links publicos sao bloqueados para arquivos criptografados.
- O arquivo em disco fica criptografado antes de entrar na fila de aprovacao.
- Metadados ficam em `data/encrypted-files.json`.

## Recuperacao

Para recuperar apos desastre:

1. Restaurar `uploads/` e `data/encrypted-files.json`.
2. Restaurar a mesma `SERVER_MASTER_KEY` ou `data/server-master.key`.
3. Garantir que usuarios/senhas de acesso estejam restaurados.

Sem a chave mestra correta e, quando aplicavel, sem a senha do arquivo, a descriptografia falhara por design.
