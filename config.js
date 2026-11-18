// Настройки подключения к серверу (Supabase).
// Публичный адрес и публичный ключ (anon key) можно хранить в открытом коде —
// они специально для этого предназначены. Секретные ключи (service key, ключ OpenAI)
// здесь НИКОГДА не пишем: они хранятся только в секретах Supabase.
window.APP_CONFIG = {
  supabaseUrl: "",      // например: https://abcdefgh.supabase.co
  supabaseAnonKey: ""   // публичный ключ проекта (anon / publishable)
};
