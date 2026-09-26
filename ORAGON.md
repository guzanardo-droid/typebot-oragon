# Typebot da Oragon

Cópia do [Typebot](https://github.com/baptisteArno/typebot.io) que roda na Vercel da Oragon, travada
numa versão. O branch de produção é o `oragon`, e a versão de origem está na mensagem do primeiro commit.

- Editor: https://typebot.oragon.app.br (projeto Vercel `typebot-builder`)
- Bots: https://bot.oragon.app.br (projeto Vercel `typebot-viewer`)
- Banco: Neon, projeto `typebot-oragon`, banco `typebot`, região sa-east-1

## O que muda em relação ao original

- `apps/builder/next.config.mjs`: a variável `ORAGON_FRAME_ANCESTORS` libera o editor para ser
  embutido no menu Bot do CRM (`https://www.oragon.app.br`). Sem a variável, o comportamento é o original.

- `packages/bot-engine/src/oragon/notificarOragon.ts` + 1 chamada em
  `saveStateToDatabase.ts`: a cada resposta gravada, avisa o CRM (Edge Function
  `bot-resultado`) com a lista pergunta → resposta e as variáveis — é a
  integração automática bot → CRM, sem bloco HTTP no fluxo. Roda em `after()`
  (depois da resposta ao lead). Liga com `ORAGON_RESULT_WEBHOOK_URL` e
  `ORAGON_RESULT_WEBHOOK_SECRET` no projeto dos bots (viewer); sem elas, não faz nada.

## Licença

A licença é FSL-1.1-Apache-2.0 (veja `LICENSE`). O uso permitido aqui: a equipe GrowX monta os bots para os
clientes. O editor NÃO é oferecido aos experts sem licença comercial. Ver o plano em
`crm-oragon/docs/bot.md`.

## Atualizar de versão

```sh
git fetch upstream --tags
git checkout oragon
git merge vX.Y.Z   # resolver conflito só no next.config do builder, se houver
git push origin oragon
```

Leia antes o `CHANGELOG.md` e `apps/docs/self-hosting/breaking-changes`. O build de produção roda
`prisma migrate deploy`, e o banco não aceita voltar de versão.
