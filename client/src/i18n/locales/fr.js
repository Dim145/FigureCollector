// FigureCollector — French strings.
// Keep keys flat (dot.namespaced) for predictable `t("foo.bar")` lookups.
export default {
  "app.name": "FigureCollector",
  "app.tagline_jp": "雪 の 蒐 集 者",
  "app.tagline_en": "Catalogue your shelf, figure by figure.",
  "app.phase": "v0.1.0 · phase 1B",

  // Navigation
  "nav.signin": "Se connecter",
  "nav.signup": "Créer un compte",
  "nav.signout": "Se déconnecter",
  "nav.account": "Mon compte",
  "nav.home": "Accueil",

  // Landing
  "landing.greeting": "Bienvenue, {name}",
  "landing.welcome_back": "Heureux de te revoir.",
  "landing.cta_signin": "Se connecter",
  "landing.cta_signup": "Créer un compte",
  "landing.bootstrap_note": "Squelette en place. Backend Rust et client React opérationnels — l'inventaire arrive en Phase 2.",

  // Login
  "login.title": "Connexion",
  "login.subtitle": "Accède à ta vitrine.",
  "login.field.username": "Nom d'utilisateur",
  "login.field.password": "Mot de passe",
  "login.submit": "Entrer",
  "login.no_account": "Pas encore de compte ?",
  "login.register_link": "Créer un compte",
  "login.oidc_continue": "Continuer avec {provider}",
  "login.or_local": "ou avec un compte local",

  // Register
  "register.title": "Créer un compte",
  "register.subtitle": "Inscris-toi pour cataloguer ta collection.",
  "register.field.username": "Nom d'utilisateur",
  "register.field.username_hint": "3 à 32 caractères, lettres / chiffres / _ - .",
  "register.field.password": "Mot de passe",
  "register.field.password_hint": "10 caractères minimum",
  "register.field.email": "Email (optionnel)",
  "register.field.display_name": "Nom affiché (optionnel)",
  "register.submit": "Créer le compte",
  "register.have_account": "Déjà inscrit ?",
  "register.login_link": "Se connecter",
  "register.disabled": "Les inscriptions sont actuellement fermées.",

  // Errors
  "error.unknown": "Une erreur inattendue s'est produite.",
  "error.network": "Impossible de joindre le serveur.",
  "error.invalid_credentials": "Identifiants incorrects.",
  "error.conflict": "Ce nom d'utilisateur ou cet email est déjà pris.",
  "error.bad_request": "Données invalides : {message}",
  "error.rate_limited": "Trop de tentatives. Réessaye dans quelques secondes.",
  "error.feature_disabled": "Cette fonctionnalité est désactivée.",
  "error.not_implemented": "À venir.",

  // Validation
  "validation.required": "Ce champ est requis.",
  "validation.username_pattern": "Lettres, chiffres, _ - . uniquement.",
  "validation.password_min": "10 caractères minimum.",

  // Navigation (in-app)
  "nav.collection": "Ma collection",
  "nav.preorders": "Pré-commandes",
  "nav.add_figure": "Ajouter une figurine",
  "nav.catalog": "Catalogue",

  // Collection
  "collection.title": "Ma collection",
  "collection.subtitle": "Pièce par pièce.",
  "collection.empty.title": "Aucune figurine pour l'instant",
  "collection.empty.body": "Crée une fiche dans le catalogue puis ajoute-la à ta collection.",
  "collection.empty.cta": "Ajouter une figurine",
  "collection.remove": "Retirer de la collection",
  "collection.count": "{n} pièce(s)",

  // Conditions
  "condition.mib_sealed": "MIB · scellée",
  "condition.opened_box": "Boîte ouverte",
  "condition.displayed": "Exposée",
  "condition.loose": "Loose (sans boîte)",
  "condition.damaged": "Endommagée",

  // Figure types
  "type.scale": "Scale",
  "type.nendoroid": "Nendoroid",
  "type.figma": "Figma",
  "type.prize": "Prize",
  "type.trading": "Trading",
  "type.statue": "Statue",
  "type.plamo": "Plamo (kit)",
  "type.bishoujo": "Bishoujo",
  "type.dakimakura": "Dakimakura",
  "type.other": "Autre",

  // Add figure form
  "addfig.title": "Ajouter une figurine au catalogue",
  "addfig.field.name": "Nom",
  "addfig.field.manufacturer": "Fabricant",
  "addfig.field.sculptor": "Sculpteur",
  "addfig.field.series": "Série d'origine",
  "addfig.field.character": "Personnage",
  "addfig.field.type": "Type",
  "addfig.field.scale": "Échelle",
  "addfig.field.height_mm": "Hauteur (mm)",
  "addfig.field.materials": "Matériaux (séparés par des virgules)",
  "addfig.field.release_date": "Date de sortie",
  "addfig.field.msrp": "Prix officiel (MSRP)",
  "addfig.field.currency": "Devise",
  "addfig.field.jan": "Code-barres JAN/EAN",
  "addfig.field.edition": "Édition",
  "addfig.field.version_name": "Version",
  "addfig.submit": "Créer la fiche",
  "addfig.also_add": "Aussi l'ajouter à ma collection",
  "addfig.lookup_anilist": "Chercher la série sur AniList",
  "addfig.lookup_placeholder": "Vocaloid, Demon Slayer, FF VII…",
  "addfig.lookup_apply": "Utiliser ce résultat",
  "addfig.lookup_no_results": "Aucun résultat AniList.",
  "addfig.lookup_min": "Au moins 2 caractères.",

  // Figure detail
  "figure.add_to_collection": "Ajouter à ma collection",
  "figure.already_owned": "Dans ta collection",
  "figure.create_preorder": "Pré-commander",
  "figure.specs": "Caractéristiques",
  "figure.spec.manufacturer": "Fabricant",
  "figure.spec.sculptor": "Sculpteur",
  "figure.spec.scale": "Échelle",
  "figure.spec.height": "Hauteur",
  "figure.spec.materials": "Matériaux",
  "figure.spec.release": "Sortie",
  "figure.spec.msrp": "MSRP",
  "figure.spec.jan": "JAN",
  "figure.spec.edition": "Édition",
  "figure.spec.version": "Version",
  "figure.spec.exclusivity": "Exclusivité",

  // Preorders
  "preorders.title": "Pré-commandes",
  "preorders.subtitle": "Les sorties qui glissent, dûment notées.",
  "preorders.empty": "Aucune pré-commande pour l'instant.",
  "preorders.field.figure": "Figurine",
  "preorders.field.store": "Boutique",
  "preorders.field.order_ref": "N° de commande",
  "preorders.field.release_date": "Date de sortie annoncée",
  "preorders.field.status": "Statut",
  "preorders.slip_one": "1 report",
  "preorders.slip_many": "{n} reports",
  "preorders.no_slip": "Date d'origine respectée",
  "preorders.original_was": "À l'origine : {date}",
  "preorders.bump_date": "Mettre à jour la date",
  "preorders.bump_note": "Raison du report (optionnel)",
  "preorders.history_title": "Historique des reports",

  // Statuses
  "status.announced": "Annoncée",
  "status.preorder_open": "Pré-commande ouverte",
  "status.preordered": "Pré-commandée",
  "status.in_production": "En production",
  "status.released": "Sortie",
  "status.shipped": "Expédiée",
  "status.received": "Reçue",
  "status.cancelled": "Annulée",

  // Nav (Phase 2B/3/4)
  "nav.browse": "Catalogue",
  "nav.settings": "Paramètres",
  "nav.search": "Rechercher",
  "nav.profile": "Mon profil public",

  // Browse
  "browse.title": "Catalogue",
  "browse.subtitle": "Toutes les figurines, qu'on les possède ou non.",
  "browse.search_placeholder": "Rechercher une figurine…",
  "browse.filter_type": "Type",
  "browse.filter_all": "Toutes",
  "browse.empty": "Aucune figurine ne correspond.",

  // Photos
  "photos.upload": "Ajouter une photo",
  "photos.title": "Photos",
  "photos.empty": "Aucune photo pour cette pièce.",
  "photos.uploading": "Envoi en cours…",
  "photos.remove": "Retirer cette photo",

  // Profile public
  "profile.public_title": "Profil de {name}",
  "profile.member_since": "Membre depuis {date}",
  "profile.stat_pieces": "Pièces",
  "profile.stat_series": "Séries",
  "profile.stat_manufacturers": "Fabricants",
  "profile.private": "Ce profil est privé.",

  // Compare
  "compare.title": "Comparer avec {name}",
  "compare.bucket.common": "En commun",
  "compare.bucket.yours_only": "Toi seul·e",
  "compare.bucket.theirs_only": "Lui/elle seul·e",
  "compare.empty_bucket": "—",
  "compare.self": "Tu ne peux pas te comparer à toi-même.",

  // Settings
  "settings.title": "Paramètres",
  "settings.public_profile": "Profil public",
  "settings.public_profile.body": "Active pour rendre ta collection visible sur /u/{username}, et pour que d'autres utilisateurs puissent comparer leur collection à la tienne.",
  "settings.public_profile.url": "URL publique",
  "settings.copy_url": "Copier l'URL",

  // Command palette
  "palette.placeholder": "Chercher une page, une figurine, un fabricant…",
  "palette.hint_open": "⌘K",
  "palette.no_results": "Aucun résultat",
  "palette.group.navigation": "Navigation",
  "palette.group.collection": "Ma collection",
  "palette.group.catalog": "Catalogue",
};
