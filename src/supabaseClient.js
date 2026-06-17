import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://zdlsjnwhxjbxtgwwushh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_UEdWb2Ql0dHdqv_3W6rNtA_1Ppe-CGM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
