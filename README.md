# Mon Coloriage

Application web progressive (PWA) qui transforme un dessin en couleur en page à colorier :
un grand dessin au trait noir sur fond blanc, avec le modèle en couleur en petit dans le coin supérieur gauche.

- Formats acceptés : JPEG, PNG, WebP, GIF, BMP, AVIF, et HEIC sur iPhone (tout ce que le navigateur sait lire).
- Export en PNG ou en PDF (A4), et bouton « Partager » sur iPhone (Enregistrer l'image, Imprimer…).
- Fonctionne hors ligne après la première ouverture (service worker). Les images ne quittent jamais l'appareil.
- Aucune dépendance, aucun outil de compilation : uniquement HTML, CSS et JavaScript.

## Installer sur iPhone

1. Ouvrir l'adresse de l'application dans **Safari** (il faut une adresse en `https://`, par exemple GitHub Pages).
2. Bouton **Partager** → **Sur l'écran d'accueil**.
3. Ouvrir l'application une fois avec une connexion : ensuite elle marche en mode avion.

## Publier avec GitHub Pages

Le workflow `.github/workflows/pages.yml` publie le site à chaque push sur `main`.
Dans le dépôt : **Settings → Pages → Source : GitHub Actions**.

## Tester en local

```sh
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Comment ça marche

`js/linework.js` combine deux détecteurs :

1. **Traits noirs du dessin** : seuil adaptatif sur la luminance (un pixel est un trait s'il est nettement plus sombre que son voisinage). Les grandes zones sombres (cheveux noirs…) ne deviennent pas des aplats noirs.
2. **Contours entre les couleurs** : détecteur de Canny sur les canaux R, V, B lissés, pour les bords qui n'ont pas de trait noir.

Puis les petites taches sont supprimées et les traits épaissis selon les réglages.
`js/layout.js` place la miniature en haut à gauche et agrandit le dessin au maximum sans que ses traits ne passent sous la miniature.
`js/pdf.js` écrit un PDF A4 sans bibliothèque externe.

## Limites

- Très bon résultat sur les dessins animés, BD et illustrations avec contours noirs et fond uni.
- Sur les photos, le résultat est plus chargé : utiliser le préréglage « Photo » et augmenter « Nettoyage ».
- Une petite image (moins de 500 px) donne des traits plus épais et moins précis : préférer une image en bonne résolution.
- Le recadrage automatique ne fonctionne que si le fond est uni.

Pensez à changer `CACHE` dans `sw.js` à chaque nouvelle version pour que les iPhone récupèrent la mise à jour.
