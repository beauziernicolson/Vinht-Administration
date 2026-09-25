# VinHT — Plateforme Web e-commerce & marketplace

VinHT est une plateforme Web de commerce électronique conçue pour centraliser, dans un même environnement, l’achat, la vente, la gestion marchande, le traitement des commandes et la livraison.

**Site de production :** https://vinht.store

Ce dépôt constitue la version technique de présentation de l’application Web destinée à la revue administrative. Il privilégie le code réellement utile à l’exécution et à l’audit du produit, sans historique de travail, notes internes, fichiers temporaires ou documentation de développement obsolète.

## Présentation

VinHT repose sur une architecture Web multi-rôles. Une même plateforme sert plusieurs parcours métiers tout en conservant une séparation des permissions et des responsabilités côté serveur.

Les principaux espaces sont :

- **Client** : catalogue, recherche, fiches produit, variantes, panier, checkout, commandes, compte et suivi de livraison.
- **Marchand** : boutique, catalogue, produits, stock, commandes, promotions, revenus et préparation des commandes.
- **Livreur** : disponibilité, missions, prise en charge, étapes de livraison et confirmation de remise.
- **Administration** : supervision des utilisateurs, marchands, produits, commandes, promotions, candidatures, logistique, paramètres et opérations de contrôle.
- **Agent** : accès opérationnel délégué selon les permissions attribuées par la plateforme.

## Principes métier

VinHT applique plusieurs règles structurantes :

- le navigateur n’est jamais la source financière autoritaire ;
- les prix, frais, remises, stocks et totaux transactionnels sont validés côté serveur ;
- les produits à variantes utilisent des identifiants de variantes réels retournés par le backend ;
- un panier transactionnel ne mélange pas plusieurs devises ;
- les actions de livraison sont pilotées par les capacités et transitions autorisées par le backend ;
- les rôles et permissions ne sont pas fabriqués par l’interface ;
- les opérations sensibles utilisent des contrats serveur explicites et des contrôles d’accès.

## Architecture technique

```text
Navigateur Web
│
├── Pages HTML / CSS
├── JavaScript ES Modules
│   ├── pages/       contrôleurs d’écrans
│   ├── services/    accès aux données et contrats métier
│   ├── ui/          composants et comportements partagés
│   ├── lib/         utilitaires techniques
│   └── data/        taxonomies et données de présentation
│
├── API Web sécurisées (/api)
│   ├── MonCash
│   └── FlexiCash
│
└── Supabase
    ├── Authentification
    ├── PostgreSQL
    ├── Row Level Security
    ├── RPC métier
    └── Edge Functions
```

### Frontend

Le frontend est construit en **HTML5, CSS et JavaScript ES Modules**, sans framework SPA imposé. `js/main.js` agit comme point d’entrée partagé et initialise les fonctionnalités uniquement lorsqu’une page expose les éléments correspondants.

Cette approche permet de conserver des pages explicites, un chargement progressif des modules et une séparation claire entre interface et services métier.

### Backend

Le backend transactionnel s’appuie sur **Supabase**. Les données sensibles et les décisions métier autoritaires sont traitées par PostgreSQL, les politiques RLS, les RPC et les fonctions serveur.

Le navigateur utilise uniquement les capacités prévues pour le client public/authentifié. Les secrets de fournisseur, clés privées et privilèges `service_role` ne doivent jamais être embarqués dans le code frontend.

### API Web

Le dossier `api/` contient les routes serveur nécessaires aux intégrations de paiement exposées par l’application Web.

#### MonCash

- `POST /api/moncash/create-payment`
- `POST /api/moncash/verify-payment`

La création de paiement ne fait pas confiance à un montant transmis par le navigateur : le proxy transmet l’identité de la commande au backend autoritaire, qui détermine les données financières réelles.

#### FlexiCash

- `POST /api/flexicash/create-payment`
- `POST /api/flexicash/payment-methods`
- `POST /api/flexicash/verify-payment`
- `POST /api/flexicash/webhook`

Le webhook conserve le corps brut et les en-têtes de signature nécessaires à la validation serveur.

## Paiements

Le parcours de paiement suit le principe suivant :

```text
Panier
  ↓
Création serveur de la commande
  ↓
Création du paiement chez le fournisseur
  ↓
Redirection sécurisée vers le fournisseur
  ↓
Retour vers VinHT
  ↓
Vérification serveur
  ↓
Mise à jour de l’état de paiement
```

L’interface ne considère pas un paiement comme réussi simplement parce qu’une redirection ou une requête cliente s’est terminée. L’état final provient du serveur.

## Logistique et livraison

Le système de livraison sépare la commande commerciale de la mission logistique. Les transitions importantes — publication d’une mission, prise en charge, arrivée au point de retrait, remise marchand, transit, arrivée à destination et confirmation client — dépendent des contrats et capacités retournés par le backend.

Cette séparation évite de déduire des permissions sensibles à partir d’un simple statut affiché dans l’interface.

## Sécurité

La conception Web applique notamment les principes suivants :

- authentification et session gérées avec Supabase Auth ;
- contrôles d’accès serveur et RLS ;
- séparation des rôles Client, Marchand, Livreur, Agent et Admin ;
- absence de clés privées ou de secrets fournisseur dans le navigateur ;
- montants transactionnels déterminés côté serveur ;
- validation des identifiants produits et variantes avant checkout ;
- vérification serveur des paiements ;
- conservation du corps brut pour les webhooks signés ;
- limitation des données persistées côté navigateur aux informations non autoritaires nécessaires à l’expérience utilisateur.

## Structure du dépôt

```text
Vinht-Administration/
├── admin/                 interfaces d’administration
├── agent/                 espace agent
├── api/                   routes serveur Web pour les paiements
│   ├── flexicash/
│   └── moncash/
├── assets/                ressources visuelles nécessaires
├── courier/               espace livreur
├── css/                   styles spécialisés
├── images/                ressources d’intégration et de paiement
├── js/
│   ├── data/              taxonomies de présentation
│   ├── lib/               utilitaires
│   ├── pages/             logique des pages
│   ├── services/          services métier et accès backend
│   ├── ui/                composants UI partagés
│   ├── config.js
│   └── main.js
├── merchant/              espace marchand
├── partials/              fragments HTML partagés
├── *.html                 pages Web publiques et client
├── *.css                  styles globaux et fonctionnels
├── .gitignore
└── README.md
```

## Exécution locale

Le frontend peut être servi avec n’importe quel serveur HTTP statique. Exemple avec Python :

```bash
python3 -m http.server 4173
```

Puis ouvrir :

```text
http://localhost:4173
```

Les routes du dossier `api/` nécessitent un environnement compatible avec les fonctions serveur utilisées en production. Une simple ouverture des fichiers HTML sur le système de fichiers n’est pas recommandée, notamment à cause des modules ES, des sessions et des politiques CORS.

## Configuration

La configuration navigateur se trouve dans `js/config.js` et doit uniquement contenir des informations publiables côté client.

Les identifiants secrets des fournisseurs de paiement et tout privilège backend élevé doivent être configurés dans l’environnement serveur correspondant, jamais ajoutés au dépôt.

## Qualité et validation

La version de présentation fait l’objet de contrôles automatisables portant notamment sur :

- la syntaxe JavaScript ;
- la résolution des modules locaux ;
- la présence des ressources statiques référencées ;
- l’absence de fichiers internes ou temporaires ;
- l’absence de formats courants de secrets ou de clés privées ;
- la cohérence du périmètre Web remis à l’administration.

La règle de validation du projet est la suivante : **une fonctionnalité n’est considérée comme terminée que lorsqu’elle est implémentée, documentée, testée et validée dans son périmètre.**

## Déploiement

L’application Web de production est publiée sur **Vercel** et utilise **Supabase** comme infrastructure backend. Le déploiement doit conserver la séparation entre :

1. ressources frontend publiques ;
2. routes serveur `/api` ;
3. backend Supabase et politiques d’accès ;
4. secrets et identifiants fournisseurs stockés uniquement dans les environnements sécurisés.

Les modifications de production doivent suivre un cycle de validation avant publication et permettre un retour à une version stable en cas de régression.

## Périmètre de ce dépôt

Ce dépôt de remise contient le code Web nécessaire à la compréhension et à l’évaluation de VinHT ainsi que les proxys Web de paiement pouvant être présentés sans exposer de secret.

Les secrets d’infrastructure, identifiants privés de fournisseurs et données de production ne font pas partie du dépôt. Les mécanismes backend autoritaires restent protégés dans leur environnement d’exécution.

---

**VinHT** — Plateforme Web e-commerce & marketplace.
