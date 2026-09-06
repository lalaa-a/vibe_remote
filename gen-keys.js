import jwt from 'jsonwebtoken'

// gen-keys.js — run with: node gen-keys.js
//const jwt = require('jsonwebtoken')

const JWT_SECRET = '__add__your__token'

const anonKey = jwt.sign(
  { role: 'anon', iss: 'supabase', iat: 1741910400, exp: 1899676800 },
  JWT_SECRET
)

const serviceKey = jwt.sign(
  { role: 'service_role', iss: 'supabase', iat: 1741910400, exp: 1899676800 },
  JWT_SECRET
)

//expire date is in 2030

console.log('ANON_KEY=', anonKey)
console.log('SERVICE_ROLE_KEY=', serviceKey)
