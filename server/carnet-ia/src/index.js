// ===== Serveur IA de Carnet (Cloudflare Worker) =====
//
// Le site ne connaît jamais la clé secrète : il envoie le texte ici, ce serveur
// ajoute la clé (variable secrète ANTHROPIC_API_KEY) et interroge Claude.
//
// Réglages (voir LISEZMOI.md) :
//   ANTHROPIC_API_KEY  secret obligatoire : la clé de l'API Anthropic
//   ALLOWED_ORIGINS    adresses autorisées, séparées par des virgules (ex. https://mehdi93k.github.io)
//   ACCESS_CODE        secret facultatif : un code à saisir dans Carnet pour pouvoir utiliser le serveur
//   MODEL              modèle utilisé (par défaut claude-opus-5-5)

import Anthropic from '@anthropic-ai/sdk';
import { ACTIONS, validateRequest, buildRequest } from './actions.js';

const DEFAULT_MODEL = 'claude-opus-5-5';
// Ces modèles savent relancer une demande refusée par erreur sur un autre modèle (« fallbacks »)
const SUPPORTS_FALLBACK = /^claude-(opus-5|fable-5-1|sonnet-5-5)/;

// Limite simple : 20 demandes par adresse IP toutes les 10 minutes.
// (Approximative : chaque copie du serveur garde sa propre mémoire.)
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 20;
const hits = new Map();

function tooManyRequests(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
}

function corsHeaders(origin, allowed) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Carnet-Code',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

const reply = (data, status, headers) => new Response(JSON.stringify(data), {
  status,
  headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
});

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = allowedOrigins(env);
    const headers = corsHeaders(origin, allowed);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!allowed.includes(origin)) return reply({ error: 'origin' }, 403, headers);
    if (request.method !== 'POST') return reply({ error: 'method' }, 405, headers);
    if (env.ACCESS_CODE && request.headers.get('X-Carnet-Code') !== env.ACCESS_CODE) return reply({ error: 'code' }, 401, headers);
    if (!env.ANTHROPIC_API_KEY) return reply({ error: 'config' }, 500, headers);
    if (Number(request.headers.get('Content-Length') || 0) > 100000) return reply({ error: 'too_long' }, 413, headers);
    if (tooManyRequests(request.headers.get('CF-Connecting-IP') || 'inconnu')) return reply({ error: 'rate' }, 429, headers);

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return reply({ error: 'body' }, 400, headers);
    }
    const checked = validateRequest(body);
    if (checked.error) return reply({ error: checked.error }, checked.error === 'too_long' ? 413 : 400, headers);

    const model = env.MODEL || DEFAULT_MODEL;
    // « ping » : vérifie le branchement (adresse, code) sans interroger Claude, donc sans frais
    if (checked.action === 'ping') return reply({ ok: true, model }, 200, headers);

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const params = buildRequest(checked, model);

    try {
      const response = SUPPORTS_FALLBACK.test(model)
        ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await client.messages.create(params);

      // Claude peut refuser une demande : on le dit au site au lieu de renvoyer un texte vide
      if (response.stop_reason === 'refusal') return reply({ error: 'refusal' }, 422, headers);

      const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
      const truncated = response.stop_reason === 'max_tokens';

      if (ACTIONS[checked.action].schema) {
        let data;
        try {
          data = JSON.parse(text);
        } catch (error) {
          return reply({ error: 'format' }, 502, headers);
        }
        return reply({ data, truncated, model: response.model }, 200, headers);
      }
      return reply({ text, truncated, model: response.model }, 200, headers);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) return reply({ error: 'key' }, 502, headers);
      if (error instanceof Anthropic.RateLimitError) return reply({ error: 'busy' }, 503, headers);
      if (error instanceof Anthropic.BadRequestError) return reply({ error: 'bad', detail: error.message }, 502, headers);
      if (error instanceof Anthropic.APIError) return reply({ error: 'upstream', status: error.status }, 502, headers);
      return reply({ error: 'network' }, 502, headers);
    }
  },
};
