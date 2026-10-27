# Brancher l'assistant IA de Carnet

Carnet est un site statique : il ne peut pas garder de secret. Pour parler à Claude, il passe donc par ce petit serveur, qui garde la clé API et n'accepte que les actions de Carnet (résumer, expliquer, flashcards…).

```
Carnet (ton navigateur) ──texte choisi──▶ ce serveur (Cloudflare) ──+ clé secrète──▶ API Claude (Anthropic)
```

## Ce qu'il faut

- Une **clé API Anthropic** : sur <https://console.anthropic.com>, rubrique des clés API. L'API est payante à l'usage : fixe une **limite de dépense mensuelle** dans les réglages de facturation (par exemple 5 $).
- Un **compte Cloudflare** gratuit : <https://dash.cloudflare.com/sign-up>. L'offre gratuite suffit (100 000 requêtes par jour).
- **Node.js**, déjà présent sur ton PC.

## Installer (une seule fois)

Dans un terminal, depuis ce dossier `server/carnet-ia` :

```bash
npm install @anthropic-ai/sdk
```

```bash
npm install --save-dev wrangler
```

```bash
npx wrangler login
```

Ajoute la clé (elle est demandée, puis gardée chiffrée chez Cloudflare, jamais dans le code) :

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Facultatif mais conseillé : un code d'accès, pour que toi seul puisses utiliser ton serveur.

```bash
npx wrangler secret put ACCESS_CODE
```

Mets le serveur en ligne :

```bash
npx wrangler deploy
```

Wrangler affiche une adresse du type `https://carnet-ia.ton-compte.workers.dev`.

## Dans Carnet

**Paramètres › Assistant IA** : colle l'adresse du serveur (et le code d'accès si tu en as mis un), puis **Enregistrer**. Carnet vérifie le branchement sans rien envoyer à Claude.

## Combien ça coûte

Prix publics de l'API (par million de *tokens* ; un token ≈ 3/4 de mot) :

| Modèle (`MODEL` dans `wrangler.toml`) | Entrée | Sortie | Une demande typique* |
|---|---|---|---|
| `claude-opus-5-5` (par défaut, le plus fin) | 4 $ | 20 $ | environ 3 centimes |
| `claude-haiku-5-5` (environ 40 fois moins cher) | 0,10 $ | 0,50 $ | moins de 0,1 centime |

\* Un cours d'environ 1 500 mots et une réponse d'une page. Une fiche ou 15 flashcards coûtent un peu plus.

Pour changer de modèle : modifie `MODEL` dans `wrangler.toml`, puis relance `npx wrangler deploy`.

## Sécurité et données

- La clé reste chez Cloudflare (secret chiffré). Elle n'est ni dans le site, ni sur GitHub.
- Le serveur refuse les sites qui ne sont pas dans `ALLOWED_ORIGINS`, les textes de plus de 20 000 caractères, et plus de 20 demandes par tranche de 10 minutes et par adresse.
- Il ne garde aucune note : il transmet le texte choisi à Anthropic et renvoie la réponse.
- Anthropic traite ce texte pour produire la réponse, selon ses conditions de l'API : <https://www.anthropic.com/legal/privacy>.
- Carnet n'envoie rien sans un clic, et demande ton accord la première fois.

## Tester en local (facultatif)

```bash
npx wrangler dev
```

Ajoute alors `http://localhost:8765` (l'adresse de ton Carnet local) à `ALLOWED_ORIGINS`.
