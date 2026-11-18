// Настройки подключения к серверу (Supabase).
// Публичный адрес и публичный ключ (anon key) можно хранить в открытом коде —
// они специально для этого предназначены. Секретные ключи (service key, ключ OpenAI)
// здесь НИКОГДА не пишем: они хранятся только в секретах Supabase.
window.APP_CONFIG = {
  supabaseUrl: "https://ipqcqexoymvfoxejypyr.supabase.co",
  supabaseAnonKey: "sb_publishable_vt-_BHI13a_lgHbYJ4Hj8Q_JZnVFMRp",  // публичный ключ (publishable)
  aiEnabled: true       // подбор через серверную функцию ИИ (supabase/functions/ai в репозитории kino)
};
