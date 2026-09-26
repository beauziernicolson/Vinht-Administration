# VinHT — Dossier technique Web pour revue administrative

VinHT est une plateforme Web de commerce électronique de type **marketplace multi-acteurs**, conçue pour réunir dans une même application le catalogue, la vente, les promotions, le paiement, la préparation des commandes, la livraison et les opérations d’administration.

**Application de production :** https://vinht.store

Ce dépôt public est la **version de remise administrative du produit Web**. Il est volontairement limité au code utile à l’exécution, à la compréhension et à l’audit de l’application Web. Il ne contient pas les secrets d’infrastructure, les données de production, les documents de travail internes, les historiques de passation, les fichiers d’assistants IA ni le chantier Mobile/Capacitor.

> Ce dépôt ne remplace pas le repository privé de développement. Il présente le périmètre Web remis à l’administration sans exposer les éléments sensibles qui n’ont pas vocation à être publics.

---

## 1. Présentation du produit

VinHT relie plusieurs catégories d’utilisateurs autour d’un même backend métier :

- **Client / Acheteur** : catalogue, recherche, variantes, panier, checkout, commandes, compte et suivi de livraison.
- **Marchand** : produits, stock, commandes, promotions, préparation, expédition et suivi de son activité.
- **Livreur** : disponibilité, missions, prise en charge, progression de livraison et confirmation de remise.
- **Agent** : opérations déléguées selon les capacités accordées par le backend.
- **Administrateur** : supervision de la plateforme, utilisateurs, marchands, catalogue, commandes, logistique, promotions et paramètres opérationnels.

Le produit applique un principe architectural constant : **le navigateur affiche et collecte les choix utilisateur, mais les décisions sensibles restent autoritaires côté serveur**.

---

## 2. Périmètre de ce repository

### Inclus

- pages Web publiques et client ;
- espaces Marchand, Livreur, Agent et Administration ;
- JavaScript applicatif partagé ;
- services frontend ;
- composants UI et utilitaires ;
- ressources visuelles nécessaires ;
- routes serveur Web pour les intégrations de paiement exposées au navigateur ;
- workflow CI de contrôle du périmètre Web ;
- README d’audit.

### Non inclus

- secrets serveur ;
- clés `service_role` ;
- credentials MonCash/FlexiCash ou autres fournisseurs ;
- données de production ;
- historique complet des migrations privées ;
- documents internes de développement ;
- handoffs, prompts et notes d’agents IA ;
- Mobile / Capacitor / Android / iOS.

Le backend autoritaire repose sur Supabase/PostgreSQL, RLS, RPC et fonctions serveur. Son architecture et ses contrats principaux sont décrits dans le **dossier administratif PDF remis séparément**.

---

## 3. Architecture générale

```text
Utilisateurs Web
      │
      ▼
HTML / CSS / JavaScript ES Modules
      │
      ├── js/pages/       contrôleurs d’écrans
      ├── js/ui/          composants et interactions partagées
      ├── js/services/    accès backend et contrats métier
      └── js/lib/         utilitaires techniques
      │
      ├──────────────► Supabase Auth
      │
      ├──────────────► PostgreSQL / RLS / RPC
      │
      └──────────────► /api/*
                         │
                         ├── MonCash
                         └── FlexiCash / plateforme
```

### Frontend

Le frontend utilise **HTML5, CSS3 et JavaScript ES Modules**. Il n’impose pas de framework SPA ni de bundler obligatoire pour fonctionner. `js/main.js` sert de point d’entrée partagé et initialise les comportements utiles selon la page affichée.

### Backend

Le backend transactionnel est basé sur **Supabase** :

- Supabase Auth ;
- PostgreSQL ;
- Row Level Security ;
- RPC métier ;
- Edge Functions ;
- configuration runtime côté serveur.

Le frontend ne possède pas la capacité de s’accorder lui-même des rôles sensibles ni de déclarer un paiement comme réussi.

---

## 4. Stack technique

| Couche | Technologie |
|---|---|
| Frontend | HTML5, CSS3, JavaScript ES Modules |
| Backend applicatif | Supabase |
| Base de données | PostgreSQL |
| Authentification | Supabase Auth |
| Autorisation | RLS + RPC + contexte d’accès backend |
| API Web | Fonctions serveur JavaScript sous `/api` |
| Paiements | MonCash + couche FlexiCash/plateforme selon disponibilité runtime |
| Hébergement Web | Vercel |
| Backend hébergé | Supabase |
| CI de remise | GitHub Actions |

---

## 5. Fonctionnalités principales

### Client

- consultation du catalogue ;
- recherche et catégories ;
- fiches produit ;
- variantes ;
- prix détail / gros ;
- panier ;
- checkout ;
- promotions ;
- commandes ;
- compte et profil ;
- suivi de livraison.

### Marchand

- gestion boutique ;
- gestion produits ;
- inventaire et variantes ;
- commandes ;
- préparation / fulfillment ;
- publication pour livraison ;
- promotions ;
- informations financières et paramètres disponibles.

### Livreur

- profil ;
- disponibilité ;
- missions disponibles ;
- prise en charge ;
- transitions de livraison ;
- confirmation de remise ;
- historique.

### Administration

- utilisateurs ;
- marchands ;
- catalogue ;
- commandes ;
- promotions ;
- candidatures ;
- logistique ;
- paramètres ;
- opérations protégées par les capacités backend.

---

## 6. Autorité des données et règles sensibles

Plusieurs garde-fous structurent le produit :

1. **Les montants transactionnels ne sont pas autoritaires dans le navigateur.** Le frontend envoie les identifiants de produit/variante, la quantité et le palier de prix ; le backend recalcule les valeurs applicables.
2. **Les rôles ne sont pas déduits localement.** Le frontend consomme un contexte d’accès renvoyé par le backend.
3. **Les paiements sont vérifiés côté serveur.** Une redirection réussie ne suffit jamais à marquer une commande comme payée.
4. **Les variantes utilisent des identifiants réels du backend.** L’interface ne fabrique pas de combinaison produit.
5. **La logistique est pilotée par des contrats serveur.** Les transitions sensibles ne sont pas inférées librement depuis l’UI.
6. **Un panier transactionnel ne mélange pas plusieurs devises.**

---

## 7. Authentification et autorisation

L’authentification utilisateur est gérée par Supabase Auth.

Le contexte d’accès applicatif provient du backend. Les rôles métier et capacités servent à déterminer les surfaces accessibles, mais **l’autorisation réelle reste appliquée côté serveur**.

Exemples de code à consulter :

- `js/services/auth.js`
- `js/services/access.js`
- `js/services/profile.js`
- `js/services/supabase.js`

---

## 8. Paiements

### MonCash

Routes Web :

```text
POST /api/moncash/create-payment
POST /api/moncash/verify-payment
```

Le navigateur transmet principalement l’identité de la commande. Les montants et l’état final restent contrôlés côté serveur.

### FlexiCash / plateforme

Routes Web :

```text
POST /api/flexicash/create-payment
POST /api/flexicash/payment-methods
POST /api/flexicash/verify-payment
POST /api/flexicash/webhook
```

Le webhook est traité comme une entrée serveur et conserve les données nécessaires à la validation de signature côté backend.

### Flux simplifié

```text
Panier
  ↓
Création serveur de la commande
  ↓
Création du paiement
  ↓
Checkout hébergé fournisseur
  ↓
Retour utilisateur
  ↓
Vérification serveur
  ↓
Mise à jour de l’état de paiement
```

---

## 9. Logistique

La commande commerciale et la mission de livraison sont traitées comme deux objets métier distincts.

Le cycle peut inclure :

- préparation marchand ;
- publication pour livraison ;
- mise à disposition de la mission ;
- prise en charge livreur ;
- arrivée au point de retrait ;
- remise marchand ;
- transit ;
- arrivée chez le client ;
- confirmation de livraison.

Les détails visibles dans l’interface sont conditionnés par les données et capacités renvoyées par le backend.

---

## 10. Sécurité

Ce repository ne prétend pas que VinHT est « invulnérable » ou « certifié ». Il expose au contraire des mécanismes vérifiables :

- Auth Supabase ;
- RLS côté PostgreSQL ;
- RPC pour les opérations sensibles ;
- séparation clé publishable / secrets serveur ;
- absence de `service_role` dans le frontend ;
- validation serveur des paiements ;
- calcul autoritaire des montants côté serveur ;
- séparation des surfaces selon les rôles/capacités ;
- restrictions de domaine pour certaines redirections de paiement ;
- contrôle automatisé contre les formes courantes de secrets commités.

Un audit du repository ne remplace pas un pentest, un audit d’infrastructure, une revue réglementaire ou une analyse complète de la configuration du projet Supabase/Vercel.

---

## 11. Structure du repository

```text
Vinht-Administration/
├── .github/workflows/ci.yml    contrôle qualité de la remise Web
├── admin/                      interfaces d’administration
├── agent/                      espace agent
├── api/
│   ├── flexicash/              routes paiement plateforme
│   └── moncash/                routes MonCash
├── assets/                     ressources visuelles
├── courier/                    espace livreur
├── css/                        styles spécialisés
├── images/                     images d’intégration / UI
├── js/
│   ├── data/                   données de présentation
│   ├── lib/                    utilitaires
│   ├── pages/                  contrôleurs de pages
│   ├── services/               services métier / backend
│   ├── ui/                     composants UI
│   ├── config.js
│   └── main.js
├── merchant/                   espace marchand
├── partials/                   fragments HTML partagés
├── *.html                      pages publiques et client
├── *.css                       styles racine
├── .gitignore
└── README.md
```

---

## 12. Exécution locale

Le frontend peut être servi par un serveur HTTP statique :

```bash
python3 -m http.server 4173
```

Puis ouvrir :

```text
http://localhost:4173
```

Une simple ouverture en `file://` n’est pas recommandée à cause des modules ES, des sessions et des politiques CORS.

Les routes `/api` nécessitent un environnement serverless compatible avec les fonctions utilisées en production.

---

## 13. Configuration

La configuration navigateur doit uniquement contenir des informations destinées à être publiques côté client.

Les éléments suivants ne doivent jamais être commités dans ce dépôt :

- `service_role` Supabase ;
- secrets fournisseurs ;
- tokens privés ;
- clés privées ;
- certificats privés ;
- mots de passe ;
- fichiers `.env` contenant des secrets.

---

## 14. Contrôles qualité du repository de remise

Le workflow `.github/workflows/ci.yml` vérifie notamment :

- syntaxe JavaScript ;
- périmètre Web uniquement ;
- absence de Mobile/Capacitor/Android/iOS ;
- absence de documents Markdown supplémentaires ;
- absence de fichiers internes connus ;
- motifs courants de secrets ;
- références locales JS/CSS/HTML ;
- présence des assets référencés.

Ces contrôles sont des garde-fous de repository. Ils ne remplacent pas les tests métier et backend exécutés dans le repository privé du produit.

---

## 15. Carte d’audit rapide

| Sujet | Où regarder |
|---|---|
| Point d’entrée Web | `js/main.js` |
| Authentification | `js/services/auth.js` |
| Contexte d’accès | `js/services/access.js` |
| Client Supabase | `js/services/supabase.js` |
| Catalogue | `js/services/catalog.js` |
| Panier | `js/services/cart.js` |
| Commandes | `js/services/orders.js`, `js/services/promotions.js` |
| Checkout | `js/pages/checkout.js` |
| Logistique | `js/services/logistics.js`, services livreur/marchand |
| Marchand | `merchant/`, `js/services/merchant*` |
| Livreur | `courier/`, `js/services/courier*` |
| Administration | `admin/`, `js/pages/admin*`, `js/services/admin*` |
| MonCash | `api/moncash/`, `js/services/moncashPayments.js` |
| FlexiCash | `api/flexicash/`, `js/services/payments.js` |
| Contrôles repository | `.github/workflows/ci.yml` |
| Architecture complète backend | dossier administratif PDF remis avec ce repository |

---

## 16. Limites et transparence

La présence d’un module dans le code ne signifie pas automatiquement qu’il est actif en Production. Certaines capacités dépendent :

- de la configuration runtime ;
- des droits de l’utilisateur ;
- de la disponibilité du fournisseur ;
- des données opérationnelles ;
- de l’état du backend.

Le repository de remise évite volontairement les affirmations telles que « 100 % sécurisé », « sans bug » ou « certifié ». L’objectif est de fournir une base technique compréhensible et vérifiable.

---

## 17. Règle de validation

> **Aucune fonctionnalité n’est considérée comme terminée si elle n’est pas documentée, testée et validée dans son périmètre.**

---

**VinHT** — Plateforme Web e-commerce & marketplace.
