'use client';

import { useSyncExternalStore } from 'react';

// Saligue in English, Kinyarwanda and French. The English text is the key, so screens translate one string at a
// time: t('Follow') gives "Kurikira" in Kinyarwanda. Text not in the list stays in English.
export type Lang = 'en' | 'rw' | 'fr';
export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'rw', label: 'Kinyarwanda' },
  { value: 'fr', label: 'Français' },
];

const DICT: Record<string, [rw: string, fr: string]> = {
  // Menus
  'For You': ['Ibikubereye', 'Pour vous'],
  Explore: ['Shakisha', 'Explorer'],
  'Fitting Room': ['Kwigeragereza', 'Cabine d’essayage'],
  Sell: ['Gurisha', 'Vendre'],
  Me: ['Njye', 'Moi'],
  Dashboard: ['Imbonerahamwe', 'Tableau de bord'],
  'Add item': ['Ongeraho', 'Ajouter'],
  Orders: ['Ibyatumijwe', 'Commandes'],
  Live: ['Live', 'En direct'],
  Messages: ['Ubutumwa', 'Messages'],
  Cart: ['Agaseke', 'Panier'],
  'Log in': ['Injira', 'Se connecter'],
  Language: ['Ururimi', 'Langue'],
  // Feed modes and controls
  Following: ['Abo nkurikira', 'Abonnements'],
  Local: ['Hafi yanjye', 'Près de moi'],
  Learn: ['Iga', 'Apprendre'],
  'Add to cart': ['Shyira mu gaseke', 'Ajouter au panier'],
  'Why am I seeing this?': ['Kuki mbona ibi?', 'Pourquoi je vois ceci ?'],
  'Show less like this': ['Nyereka bike nk’ibi', 'Moins de contenus comme ça'],
  'You’ll see less like this': ['Uzabona bike nk’ibi', 'Vous verrez moins de contenus comme ça'],
  more: ['ibindi', 'plus'],
  less: ['bike', 'moins'],
  'You’re all caught up': ['Wabibonye byose', 'Vous êtes à jour'],
  'You’ve seen everything new for now.': ['Wabonye ibishya byose kugeza ubu.', 'Vous avez tout vu pour le moment.'],
  'Learn something': ['Iga ikintu', 'Apprendre quelque chose'],
  'Take a break': ['Fata akaruhuko', 'Faire une pause'],
  '15 more minutes': ['Indi minota 15', '15 minutes de plus'],
  'How about a short break?': ['Wafata akaruhuko gato?', 'Et si vous faisiez une petite pause ?'],
  'I’m back': ['Ngarutse', 'Je suis de retour'],
  'Breathe in… and out.': ['Humeka… usohore umwuka.', 'Inspirez… et expirez.'],
  'Follow shops and teachers to see them here': ['Kurikira amaduka n’abarimu ubabone hano', 'Suivez des boutiques et des enseignants pour les voir ici'],
  'Only people you follow, newest first. No algorithm.': ['Abo ukurikira gusa, ibishya mbere. Nta algorithme.', 'Seulement les personnes que vous suivez, les plus récents d’abord. Sans algorithme.'],
  'Shops near you': ['Amaduka akwegereye', 'Boutiques près de vous'],
  'Choose your city. It stays on this phone only.': ['Hitamo umujyi wawe. Bibikwa kuri iyi telefone gusa.', 'Choisissez votre ville. Elle reste sur ce téléphone.'],
  // Follow, profile
  Follow: ['Kurikira', 'Suivre'],
  Clients: ['Abakiriya', 'Clients'],
  Rating: ['Amanota', 'Note'],
  'Go live': ['Tangira live', 'Passer en direct'],
  Stats: ['Imibare', 'Statistiques'],
  Coins: ['Ibiceri', 'Pièces'],
  Items: ['Ibicuruzwa', 'Articles'],
  Lessons: ['Amasomo', 'Leçons'],
  Shop: ['Iduka', 'Boutique'],
  Teacher: ['Umwarimu', 'Enseignant'],
  'Edit bio': ['Hindura ibikuranga', 'Modifier la bio'],
  Block: ['Hagarika', 'Bloquer'],
  Unblock: ['Kuraho ihagarika', 'Débloquer'],
  Tip: ['Agashimwe', 'Pourboire'],
  'My tips': ['Udushimwe twanjye', 'Mes pourboires'],
  'My profile': ['Umwirondoro wanjye', 'Mon profil'],
  // Learn
  Teach: ['Igisha', 'Enseigner'],
  Challenges: ['Amarushanwa', 'Défis'],
  'Teach a lesson': ['Igisha isomo', 'Donner une leçon'],
  All: ['Byose', 'Tout'],
  Styling: ['Kwambara neza', 'Style'],
  Sewing: ['Kudoda', 'Couture'],
  Care: ['Kwita ku myenda', 'Entretien'],
  'Shoes & bags': ['Inkweto n’amasakoshi', 'Chaussures et sacs'],
  Traditional: ['Gakondo', 'Traditionnel'],
  'Fashion business': ['Ubucuruzi bw’imideli', 'Business de la mode'],
  'New voice': ['Ijwi rishya', 'Nouvelle voix'],
  Answered: ['Yasubijwe', 'Répondu'],
  Question: ['Ikibazo', 'Question'],
  Reply: ['Subiza', 'Répondre'],
  Questions: ['Ibibazo', 'Questions'],
  'Add a comment…': ['Andika igitekerezo…', 'Ajouter un commentaire…'],
  'Ask the teacher…': ['Baza umwarimu…', 'Poser une question à l’enseignant…'],
  // Item page
  'Wear it': ['Yambare', 'L’essayer'],
  Buy: ['Gura', 'Acheter'],
  'Secure pay': ['Kwishyura gutekanye', 'Paiement sécurisé'],
  Tracked: ['Bikurikiranwa', 'Suivi'],
  'In stock': ['Birahari', 'En stock'],
  'Sold out': ['Byashize', 'Épuisé'],
  // Me
  'My orders': ['Ibyo natumije', 'Mes commandes'],
  Saved: ['Ibyo nabitse', 'Enregistrés'],
  Settings: ['Igenamiterere', 'Paramètres'],
  Notifications: ['Imenyesha', 'Notifications'],
  'Messages with shops': ['Ubutumwa n’amaduka', 'Messages avec les boutiques'],
  'Start selling': ['Tangira gucuruza', 'Commencer à vendre'],
  'Log out': ['Sohoka', 'Se déconnecter'],
  // Looks, Ask the shop, end of a lesson, weekly note
  'Add to a look': ['Shyira mu mwambaro', 'Ajouter à un look'],
  'Log in to make looks': ['Injira ukore imyambarire yawe', 'Connectez-vous pour créer des looks'],
  'New look, e.g. Wedding': ['Umwambaro mushya, urugero: Ubukwe', 'Nouveau look, ex. Mariage'],
  'Create look': ['Kora umwambaro', 'Créer le look'],
  'Name your first look above.': ['Andika izina ry’umwambaro wawe wa mbere hejuru.', 'Nommez votre premier look ci-dessus.'],
  'All my looks': ['Imyambaro yanjye yose', 'Tous mes looks'],
  'My looks': ['Imyambaro yanjye', 'Mes looks'],
  'Look': ['Umwambaro', 'Look'],
  'Rename': ['Hindura izina', 'Renommer'],
  'This look no longer exists.': ['Uyu mwambaro ntukiriho.', 'Ce look n’existe plus.'],
  'Save items and lessons into looks: tap': ['Bika ibicuruzwa n’amasomo mu myambaro: kanda', 'Rangez articles et leçons dans des looks : touchez'],
  'Nothing here yet. Tap': ['Nta kintu kirimo. Kanda', 'Rien ici pour l’instant. Touchez'],
  'on an item or lesson.': ['ku gicuruzwa cyangwa isomo.', 'sur un article ou une leçon.'],
  'Ask the shop': ['Baza iduka', 'Demander à la boutique'],
  'Size, fabric, delivery…?': ['Ingano, umwenda, kugeza…?', 'Taille, tissu, livraison… ?'],
  'Ask': ['Baza', 'Demander'],
  'Log in to ask the shop.': ['Injira ubaze iduka.', 'Connectez-vous pour poser une question.'],
  'No questions yet.': ['Nta bibazo birabazwa.', 'Pas encore de questions.'],
  'Waiting': ['Birategereje', 'En attente'],
  'Delete this question?': ['Gusiba iki kibazo?', 'Supprimer cette question ?'],
  'Your answer…': ['Igisubizo cyawe…', 'Votre réponse…'],
  'Answer': ['Subiza', 'Répondre'],
  'Did this help?': ['Byagufashije?', 'Cela vous a aidé ?'],
  'Thank': ['Shimira', 'Remercier'],
  'Thanked': ['Wamushimiye', 'Remercié'],
  'Again': ['Ongera', 'Revoir'],
  'Log in to thank the teacher.': ['Injira ushimire umwarimu.', 'Connectez-vous pour remercier l’enseignant.'],
  'Your week': ['Icyumweru cyawe', 'Votre semaine'],
  'Minutes': ['Iminota', 'Minutes'],
  'Saved to looks': ['Byabitswe mu myambaro', 'Gardés dans des looks'],
  'Answers': ['Ibisubizo', 'Réponses'],
  'A quiet week.': ['Icyumweru gituje.', 'Une semaine calme.'],
  'new from people you follow': ['bishya by’abo ukurikira', 'nouveautés de vos abonnements'],
  'Android app': ['Porogaramu ya Android', 'Application Android'],
};

const KEY = 'saligue-lang';
const listeners = new Set<() => void>();

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'rw' || saved === 'fr') return saved;
  } catch {
    // Storage blocked.
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en';
  return nav.startsWith('rw') ? 'rw' : nav.startsWith('fr') ? 'fr' : 'en';
}

let current: Lang | null = null;
const get = () => (current ??= typeof window === 'undefined' ? 'en' : detect());

export function setLang(lang: Lang) {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
  document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

export const useLang = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), get, () => 'en' as Lang);

export const translate = (text: string, lang: Lang) => (lang === 'en' ? text : DICT[text]?.[lang === 'rw' ? 0 : 1] ?? text);

/** t('Follow') → the text in the chosen language (English when there is no translation yet). */
export function useT() {
  const lang = useLang();
  return (text: string) => translate(text, lang);
}
