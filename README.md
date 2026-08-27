# Baustellenplanung — version Supabase

Ce projet remplace le stockage propre à l'aperçu Claude par une vraie base
Supabase, partagée entre tous les utilisateurs de l'entreprise.

## 1. Créer la base de données
Exécuter le fichier `supabase-schema.sql` (fourni à côté de ce dossier) dans
Supabase Dashboard > SQL Editor.

## 2. Configurer les variables d'environnement
```bash
cp .env.example .env
```
Puis remplir avec les valeurs de Settings > API de votre projet Supabase :
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (la clé publique "anon", pas la service_role)

## 3. Installer et lancer en local
```bash
npm install
npm run dev
```
Ouvre ensuite l'URL affichée (en général http://localhost:5173).

## 4. Déployer (Vercel, exemple)
```bash
npm install -g vercel
vercel
```
Renseigner les mêmes variables d'environnement dans les réglages du projet Vercel
(Project Settings > Environment Variables), puis redéployer.

## Sécurité — à lire avant tout déploiement public
Le schéma SQL fourni contient des policies RLS **temporaires** qui autorisent
n'importe qui possédant l'URL du site à lire et modifier tout le planning.
C'est volontairement permissif pour tester rapidement avec une petite équipe
de confiance. Avant un vrai lancement (surtout si l'URL circule au-delà de
l'équipe), il faudra mettre en place l'authentification Supabase (compte réel
par employé) et des policies RLS restrictives. Je peux m'en charger quand
vous serez prêts.

## Prochaine étape : envoi automatique du jeudi soir
Le dossier `send-weekly-plans/` et le guide `SETUP.md` (fournis séparément)
utilisent cette même base de données pour l'envoi automatique hebdomadaire —
rien à changer une fois cette migration en place, il suffira de configurer
Resend et de programmer la tâche.
