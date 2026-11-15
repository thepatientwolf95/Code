# Bot memecoins « Fomo »

Bot qui surveille en temps réel les nouveaux memecoins Solana, mise **5 €** sur ceux
qui montrent des signes de décollage, et t'envoie une **notification dès qu'un token migre**.

## Important : Fomo n'a pas d'API

L'app Fomo ne propose aucune API publique : un bot ne peut pas cliquer « acheter » dans ton
compte Fomo. Le bot travaille donc directement sur la blockchain :

- **Source des tokens** : le flux pump.fun (via PumpPortal). Ce sont les tokens de la bonding
  curve → « migré », comme dans les onglets de Fomo. La liste exacte affichée par Fomo
  (autres launchpads, filtres maison) peut différer légèrement.
- **Achats** : faits avec **un wallet Solana à toi** (clé dans `.env`), pas avec ton solde Fomo.
  Les tokens achetés n'apparaîtront donc pas dans ton portefeuille Fomo.

## Démarrage

```bash
npm install
cp .env.example .env     # puis édite .env
npm start
```

Nécessite Node.js ≥ 22. Le bot doit tourner en continu (PC allumé, ou petit VPS).

Par défaut `MODE=paper` : **simulation, aucun argent réel**. Laisse-le tourner quelques
jours, regarde le résultat, ajuste les seuils, et seulement ensuite passe en `MODE=live`.

### Notifications sur ton téléphone

Au choix (ou les deux) :

- **Telegram** : crée un bot avec [@BotFather](https://t.me/BotFather), envoie-lui un message,
  récupère ton identifiant avec @userinfobot, puis remplis `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID`.
- **ntfy** (sans compte) : installe l'app ntfy, abonne-toi à un topic au nom difficile à deviner,
  et mets ce nom dans `NTFY_TOPIC`.

Tu reçois une notification pour : chaque **token migré** (`NOTIFY_ALL_MIGRATIONS=false` pour
ne garder que tes positions), chaque achat, chaque vente, chaque erreur.

### Passer en réel

1. Crée un **wallet dédié** (Phantom, Solflare…) et n'y mets que ce que tu acceptes de perdre.
2. Exporte sa clé privée (base58) dans `WALLET_PRIVATE_KEY`, mets `MODE=live`.
3. La clé reste sur ta machine : les transactions sont signées localement. Ne commite jamais `.env`.

## Comment il décide d'acheter

Chaque nouveau token est observé `WATCH_SECONDS` (45 s), puis acheté seulement si **tout** est vrai :

| Critère | Défaut |
|---|---|
| Acheteurs uniques (hors créateur) | ≥ 12 |
| Volume achat / vente | ≥ 1,5 |
| Market cap | entre 40 et 150 SOL |
| Achat initial du créateur | ≤ 3 SOL |
| Le créateur n'a pas vendu | — |
| Part du plus gros acheteur | ≤ 40 % |
| Score global | ≥ 70/100 |

Garde-fous : 5 positions ouvertes max, 6 achats/heure, 30 €/jour.

Sorties : +100 % (take profit), −40 % (stop loss), 30 min max, ou à la migration.
Tout se règle dans `.env`.

## Limites à connaître

- **Risque** : la grande majorité des memecoins tombent à zéro. Ces filtres réduisent le bruit,
  ils ne garantissent aucun gain. Les montants de P&L affichés sont des estimations hors frais.
- **Frais** : PumpPortal prélève environ 0,5 % par ordre, plus les frais réseau et le slippage
  (`SLIPPAGE_PCT`). Sur 5 €, ça pèse.
- **Non testé en conditions réelles** : la logique est couverte par des tests (`npm test`), mais
  la connexion au flux et l'envoi d'ordres n'ont pas pu être essayés depuis l'environnement de
  développement. Le mode `paper` sert justement à valider ça chez toi avant tout achat réel.
