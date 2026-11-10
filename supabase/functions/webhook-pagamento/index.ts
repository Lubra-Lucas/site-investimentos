// RASCUNHO NÃO IMPLANTADO. Nada aqui roda em produção até o fundador implantar (ver docs/login-e-pagamento.md).
//
// Edge Function que recebe o aviso de pagamento do Asaas e atualiza a tabela `assinaturas`.
// Nenhum segredo está no código. Variáveis de ambiente (definidas com `supabase secrets set`):
//   WEBHOOK_TOKEN  -> token que você cadastra no painel do Asaas; chega no cabeçalho "asaas-access-token"
//   (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente dentro das Edge Functions)
//
// Pontos a CONFERIR na documentação do Asaas antes de implantar: nomes dos eventos, formato do payload
// (id do evento, id da assinatura, e-mail do cliente, próxima cobrança) e como identificar o plano
// (aqui: pelo campo `description` ou `externalReference` da assinatura, valores "inicial" ou "pro").

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Plano = "inicial" | "pro";
type Status = "ativa" | "atrasada" | "cancelada";

// Evento do Asaas -> status da assinatura (confirmar a lista no painel/documentação).
const EVENTO_PARA_STATUS: Record<string, Status> = {
  PAYMENT_CONFIRMED: "ativa",
  PAYMENT_RECEIVED: "ativa",
  PAYMENT_OVERDUE: "atrasada",
  PAYMENT_REFUNDED: "cancelada",
  SUBSCRIPTION_DELETED: "cancelada",
  SUBSCRIPTION_INACTIVATED: "cancelada",
};

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

// comparação sem vazar o tamanho/posição da diferença
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return resposta({ erro: "método não permitido" }, 405);

  // 1. Validar o token do cabeçalho
  const esperado = Deno.env.get("WEBHOOK_TOKEN") ?? "";
  const recebido = req.headers.get("asaas-access-token") ?? "";
  if (!esperado || !iguais(esperado, recebido)) return resposta({ erro: "não autorizado" }, 401);

  let aviso: any;
  try { aviso = await req.json(); } catch { return resposta({ erro: "json inválido" }, 400); }

  const idEvento: string | undefined = aviso?.id;
  const tipo: string = aviso?.event ?? "";
  const status = EVENTO_PARA_STATUS[tipo];
  if (!idEvento) return resposta({ erro: "evento sem id" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 2. Idempotência: o mesmo evento nunca é processado duas vezes (id_evento é chave primária)
  const { error: dup } = await admin.from("eventos_pagamento").insert({ id_evento: idEvento, tipo, payload: aviso });
  if (dup) {
    if (dup.code === "23505") return resposta({ ok: true, repetido: true }); // já visto
    return resposta({ erro: "falha ao registrar o evento" }, 500); // o provedor tenta de novo
  }

  // Evento que não muda assinatura (ex.: cobrança criada): registrado e ignorado
  if (!status) return resposta({ ok: true, ignorado: tipo });

  // 3. Achar o usuário pelo e-mail da compra (precisa ser o mesmo e-mail do login)
  const pagamento = aviso?.payment ?? aviso?.subscription ?? {};
  const email: string | undefined = pagamento?.customerEmail ?? aviso?.customer?.email;
  const idExterno: string | undefined = pagamento?.subscription ?? pagamento?.id;
  const rotulo = String(pagamento?.externalReference ?? pagamento?.description ?? "").toLowerCase();
  const plano: Plano | null = rotulo.includes("pro") ? "pro" : rotulo.includes("inicial") ? "inicial" : null;
  if (!email || !plano) return resposta({ ok: true, ignorado: "sem e-mail ou plano identificável" });

  const { data: userId } = await admin.rpc("usuario_por_email", { p_email: email });
  if (!userId) {
    // TODO: a pessoa pagou mas ainda não criou conta. Guardar para aplicar quando ela entrar (ou enviar convite).
    return resposta({ ok: true, pendente: "usuário ainda não existe" });
  }

  // 4. Gravar a assinatura (service_role ignora o RLS)
  const validoAte: string | null = pagamento?.dueDate ? new Date(pagamento.dueDate + "T23:59:59-03:00").toISOString() : null; // TODO: conferir (próxima cobrança + carência)
  const { error } = await admin.from("assinaturas").upsert({
    user_id: userId, plano, status, valido_ate: validoAte, provedor: "asaas", id_externo: idExterno ?? null,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) return resposta({ erro: "falha ao gravar a assinatura" }, 500);

  return resposta({ ok: true });
});
