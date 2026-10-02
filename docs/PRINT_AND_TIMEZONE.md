# Impression et fuseau horaire

## Fuseau métier
L'application utilise `Africa/Lubumbashi` pour toutes les dates opérationnelles et les périodes de reporting. Les instants restent stockés en UTC dans Supabase. Les limites d'une journée sont converties vers UTC avant les filtrages.

## Impression
- Impression classique : `window.print()` dans une fenêtre de reçu.
- Navigateur avec Web Bluetooth : tentative d'impression ESC/POS directe après sélection de l'imprimante.
- iPhone/iOS : partage du reçu ou impression iOS (AirPrint / app compagnon). Safari iOS ne fournit pas Web Bluetooth ; une application web ne peut donc pas ouvrir une connexion Bluetooth générique directe vers une imprimante qui n'expose pas AirPrint ou un mécanisme iOS compatible.

Le bouton Bluetooth ne remplace pas le mécanisme qui fonctionnait déjà sur Android/Windows : il s'ajoute comme voie compatible lorsque le navigateur expose Web Bluetooth.
