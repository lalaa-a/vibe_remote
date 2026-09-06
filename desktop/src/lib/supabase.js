import { createClient } from '@supabase/supabase-js';

//Database Connetion 

// Anon key is safe to ship publicly — RLS on Supabase controls access.
// Service key is NOT here. It lives only on the VPS backend.
export const SUPABASE_URL      = 'https://database.insight25.lk';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzQxOTEwNDAwLCJleHAiOjE4OTk2NzY4MDB9.cfD9K8AVYXFkQYeG0ZKIYiWwYOmuzfSXBR-DCBazEZ0';

// API URL
export const API_URL = 'https://insight25.lk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
