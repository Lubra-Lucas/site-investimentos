/* Configuração do site (preencher aqui, sem mexer no resto do código).
   canalTelegram: URL do canal público. Vazia, nenhum botão ou link do canal aparece.
   supabaseUrl e supabaseAnonKey: dados do projeto Supabase (Project Settings → API). Enquanto estiverem
     vazios, o login fica desligado: nenhum botão, nenhum script externo. A chave "anon" é pública por
     desenho (a proteção vem das regras RLS do banco). A chave "service_role" NUNCA vai no código.
   loginGoogle: true só depois de ligar o provedor Google no Supabase. */
window.CT_CONFIG = {
  canalTelegram: "https://t.me/canalterminalbot", // ex.: "https://t.me/nome_do_canal"
  supabaseUrl: "",      // ex.: "https://abcdefgh.supabase.co"
  supabaseAnonKey: "",  // chave pública (anon / publishable)
  loginGoogle: false,
};
