# THE RESISTANCE — Jeu multijoueur web

Jeu de déduction sociale inspiré des règles officielles de *The Resistance*, jouable en navigateur, en temps réel, de 5 à 10 joueurs.

**Stack** : Node.js + Express + Socket.io (serveur, logique de jeu et rôles) · HTML5 / CSS3 / JavaScript vanilla (client).

## 1. Structure du projet

```
resistance-game/
├── server.js           # Serveur Express + Socket.io, toute la logique de jeu
├── package.json
├── public/
│   ├── index.html       # Écrans : accueil, lobby, partie, fin
│   ├── style.css         # Thème espionnage (fond sombre, rouge alerte, bleu techno)
│   └── client.js          # Rendu dynamique + événements Socket.io côté client
└── README.md
```

La distribution des rôles, le calcul des équipes, la validation des votes et la
détermination du vainqueur sont **entièrement gérés côté serveur**. Le client
ne reçoit jamais l'identité des autres joueurs (sauf les co-espions, visibles
uniquement par les espions eux-mêmes, comme dans les règles officielles).

## 2. Installer et lancer en local

Prérequis : [Node.js](https://nodejs.org/) 18 ou plus récent.

```bash
# 1. Cloner le dépôt / se placer dans le dossier du projet
cd resistance-game

# 2. Installer les dépendances
npm install

# 3. Démarrer le serveur
npm start
```

Le serveur écoute par défaut sur `http://localhost:3000` (ou sur la variable
d'environnement `PORT` si elle est définie). Ouvrez cette URL dans plusieurs
onglets/navigateurs pour simuler plusieurs joueurs.

Pour tester en réseau local (plusieurs appareils sur le même Wi-Fi), utilisez
l'adresse IP locale de votre machine, ex. `http://192.168.1.23:3000`.

## 3. Règles rapides

- 5 à 10 joueurs. Le créateur de la Room (l'hôte) lance la partie.
- Rôles secrets : Résistants vs Espions (nombre d'espions selon l'effectif).
- 5 manches (missions). À chaque manche :
  1. Le Leader propose une équipe de taille fixée par le nombre de joueurs.
  2. Tout le monde vote **Pour**/**Contre** l'équipe. 5 rejets consécutifs
     dans une même manche = victoire des Espions.
  3. Si l'équipe est approuvée, ses membres votent secrètement
     **Succès**/**Échec** (un Résistant ne peut voter que Succès).
  4. Le résultat de la mission est révélé à tous.
- 3 missions réussies = victoire de la Résistance.
- 3 missions échouées = victoire des Espions.
- À 7 joueurs et plus, la mission 4 nécessite **2 échecs** pour échouer.

## 4. Déployer gratuitement sur Render (via GitHub)

1. **Pousser le projet sur GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<votre-utilisateur>/<votre-repo>.git
   git push -u origin main
   ```

2. **Créer le service sur Render**
   - Aller sur [render.com](https://render.com) → *New* → *Web Service*.
   - Connecter votre compte GitHub et sélectionner le dépôt.
   - Renseigner :
     - **Environment** : `Node`
     - **Build Command** : `npm install`
     - **Start Command** : `npm start`
     - **Plan** : *Free*
   - Render définit automatiquement la variable d'environnement `PORT` ;
     le serveur l'utilise déjà via `process.env.PORT` dans `server.js`, aucune
     modification n'est nécessaire.

3. **Déployer**
   Render construit et démarre le service automatiquement. Une fois le
   déploiement terminé, votre jeu est accessible via l'URL fournie
   (ex. `https://resistance-game.onrender.com`).

4. **Notes utiles**
   - Le plan gratuit de Render met le service en veille après une période
     d'inactivité : la première connexion après une veille peut prendre
     quelques dizaines de secondes.
   - L'état des parties est conservé **en mémoire** (pas de base de données) :
     un redémarrage du service réinitialise toutes les Rooms en cours.
   - Le code de Room est valable tant que le service tourne et que la Room
     contient au moins un joueur connecté.

## 5. Personnalisation

- Couleurs et typographies : variables CSS en tête de `public/style.css`
  (`--bg`, `--red`, `--blue`, `--font-display`, `--font-mono`).
- Tailles d'équipes / nombre d'espions par effectif : objet `GAME_CONFIG`
  en tête de `server.js`.
