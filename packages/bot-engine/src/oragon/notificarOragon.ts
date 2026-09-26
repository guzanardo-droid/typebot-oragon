import { isInputBlock } from "@typebot.io/blocks-core/helpers";
import type { Block } from "@typebot.io/blocks-core/schemas/schema";
import type { SessionState } from "@typebot.io/chat-session/schemas";
import { after } from "next/server";

/**
 * Oragon: avisa o CRM a cada resposta gravada — é a integração automática
 * bot → CRM, sem bloco HTTP no fluxo.
 *
 * Manda a lista pergunta → resposta (a pergunta é o texto das bolhas antes do
 * input, do jeito que a pessoa leu), as variáveis com valor e se o fluxo
 * terminou. O CRM (Edge Function `bot-resultado`) decide o resto: quando criar
 * o lead, em que funil, se é de uma conversa do WhatsApp.
 *
 * Roda DEPOIS da resposta ao lead (`after`), então não atrasa a conversa.
 * Sem as variáveis de ambiente, não faz nada. Nunca lança.
 */
export const notificarOragon = ({
  state,
  resultId,
  isCompleted,
}: {
  state: SessionState;
  resultId: string;
  isCompleted: boolean;
}) => {
  const url = process.env.ORAGON_RESULT_WEBHOOK_URL;
  const secret = process.env.ORAGON_RESULT_WEBHOOK_SECRET;
  if (!url || !secret) return;

  const enviar = async () => {
    try {
      const payload = montarPayload({ state, resultId, isCompleted });
      if (!payload) return;
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-oragon-secret": secret },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      console.error("oragon: aviso ao CRM falhou", error);
    }
  };

  // Fora de uma requisição (ex.: tarefa em segundo plano) o `after` lança:
  // aí manda na hora, sem esperar.
  try {
    after(enviar);
  } catch {
    void enviar();
  }
};

const montarPayload = ({
  state,
  resultId,
  isCompleted,
}: {
  state: SessionState;
  resultId: string;
  isCompleted: boolean;
}) => {
  const atual = state.typebotsQueue[0];
  if (!atual) return;
  const { typebot, answers } = atual;
  const variaveis = typebot.variables;
  // `{{nome}}` → valor, pra pergunta ler como a pessoa leu. Substituição
  // simples de propósito (o parseVariables do Typebot exige o sessionStore).
  const textoComVariaveis = (texto: string) =>
    texto.replace(/\{\{([^{}]+)\}\}/g, (inteiro, nome: string) => {
      const valor = variaveis.find((v) => v.name === nome.trim())?.value;
      if (valor === undefined || valor === null) return inteiro;
      return Array.isArray(valor) ? valor.join(", ") : String(valor);
    });

  // Chave da resposta → pergunta. Mesma regra do bot-engine: a variável do
  // input quando há; senão o título do grupo (+ " (n)" do 2º input em diante).
  const perguntas = new Map<string, { pergunta: string; tipo: string; variavel?: string }>();
  let temBlocoDoCrm = false;
  for (const group of typebot.groups) {
    let bolhas: string[] = [];
    let indiceInput = 0;
    for (const block of group.blocks as Block[]) {
      // `as string`: o tipo do bloco é uma união de literais; comparar com um
      // nome que não está nela (o "webhook" antigo) quebraria o build.
      const tipoDoBloco = block.type as string;
      if (tipoDoBloco === "text") {
        const texto = textoDaBolha(block);
        if (texto) bolhas.push(textoComVariaveis(texto));
        continue;
      }
      if (tipoDoBloco === "Webhook" || tipoDoBloco === "webhook") {
        const endereco = (block as { options?: { webhook?: { url?: string } } }).options?.webhook?.url ?? "";
        if (endereco.includes("/functions/v1/lead-inbound")) temBlocoDoCrm = true;
      }
      if (!isInputBlock(block)) continue;
      const variavel = block.options?.variableId
        ? variaveis.find((v) => v.id === block.options?.variableId)?.name
        : undefined;
      const chave =
        variavel ?? (indiceInput > 0 ? `${group.title} (${indiceInput})` : group.title);
      perguntas.set(chave, {
        pergunta: bolhas.join("\n").trim() || group.title,
        tipo: block.type,
        variavel,
      });
      indiceInput += 1;
      bolhas = [];
    }
  }

  return {
    resultId,
    typebotId: typebot.id,
    workspaceId: state.workspaceId,
    isCompleted,
    temBlocoDoCrm,
    // Na ordem em que a pessoa respondeu.
    respostas: answers.map((a) => {
      const p = perguntas.get(a.key);
      return {
        pergunta: p?.pergunta ?? a.key,
        resposta: a.value,
        tipo: p?.tipo ?? null,
        variavel: p?.variavel ?? null,
      };
    }),
    variaveis: Object.fromEntries(
      variaveis
        .filter((v) => v.value !== undefined && v.value !== null && v.value !== "")
        .map((v) => [v.name, Array.isArray(v.value) ? v.value.join(", ") : String(v.value)]),
    ),
  };
};

const textoDaBolha = (block: Block): string => {
  const content = (block as { content?: { plainText?: string; richText?: unknown[] } }).content;
  if (content?.plainText) return content.plainText.trim();
  const partes: string[] = [];
  const andar = (nos: unknown) => {
    if (!Array.isArray(nos)) return;
    for (const no of nos) {
      if (!no || typeof no !== "object") continue;
      const { text, children, type } = no as { text?: string; children?: unknown[]; type?: string };
      if (typeof text === "string") partes.push(text);
      andar(children);
      if (type === "p") partes.push("\n");
    }
  };
  andar(content?.richText);
  return partes.join("").replace(/\n{2,}/g, "\n").trim();
};
