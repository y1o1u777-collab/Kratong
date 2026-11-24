/*
 * Optional legacy gallery settings for static hosting.
 * For npm start, configure Supabase on the server in .env instead.
 */
window.KRATHONG_CONFIG = Object.freeze({
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  SUPABASE_TABLE: "krathongs",
  LOCAL_STORAGE_KEY: "krathong-wishes-v2",
  MAX_WISH_LENGTH: 180
});
