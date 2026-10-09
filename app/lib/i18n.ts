// Fixed storefront UI strings. Merchant-authored labels come from the form
// schema and are shown as entered.
import type { ValidationError } from "./submission-validation";

export const LOCALES = ["en", "de", "fr", "es", "it", "nl"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  it: "Italiano",
  nl: "Nederlands",
};

interface Strings {
  continue: string;
  optional: string;
  selectPlaceholder: string;
  reviewHeading: string;
  reviewIntro: string;
  edit: string;
  confirm: string;
  successHeading: string;
  successBody: string;
  reference: string;
  submittedAt: string;
  fixErrors: string;
  tooMany: string;
  expired: string;
  unavailable: string;
  yes: string;
  no: string;
  periodNote: (days: number) => string;
  errors: Record<ValidationError["code"], (n?: number) => string>;
}

const en: Strings = {
  continue: "Continue to review",
  optional: "optional",
  selectPlaceholder: "Please select",
  reviewHeading: "Please review your withdrawal",
  reviewIntro: "Check your details. Your withdrawal is only submitted when you click the confirmation button.",
  edit: "Edit",
  confirm: "Confirm withdrawal",
  successHeading: "Your withdrawal has been received",
  successBody: "We have recorded your withdrawal notice. A confirmation has been sent to your email address.",
  reference: "Reference number",
  submittedAt: "Received",
  fixErrors: "Please correct the highlighted fields.",
  tooMany: "Too many submissions from your connection. Please try again later.",
  expired: "Your session has expired. Please review and submit the form again.",
  unavailable: "The withdrawal form is currently unavailable. Please contact the store directly.",
  yes: "Yes",
  no: "No",
  periodNote: (d) => `The statutory withdrawal period is generally ${d} days. Exceptions may apply.`,
  errors: {
    required: () => "This field is required.",
    invalid_email: () => "Enter a valid email address.",
    invalid_phone: () => "Enter a valid phone number.",
    invalid_number: () => "Enter a number.",
    invalid_date: () => "Enter a valid date.",
    invalid_option: () => "Choose one of the available options.",
    too_short: (n) => `Enter at least ${n} characters.`,
    too_long: (n) => `Enter at most ${n} characters.`,
    too_small: (n) => `The value must be at least ${n}.`,
    too_large: (n) => `The value must be at most ${n}.`,
    invalid_format: () => "The format is not valid.",
  },
};

const de: Strings = {
  continue: "Weiter zur Überprüfung",
  optional: "optional",
  selectPlaceholder: "Bitte auswählen",
  reviewHeading: "Bitte überprüfen Sie Ihren Widerruf",
  reviewIntro: "Prüfen Sie Ihre Angaben. Der Widerruf wird erst übermittelt, wenn Sie die Bestätigungsschaltfläche klicken.",
  edit: "Bearbeiten",
  confirm: "Widerruf bestätigen",
  successHeading: "Ihr Widerruf ist eingegangen",
  successBody: "Wir haben Ihre Widerrufserklärung erfasst. Eine Bestätigung wurde an Ihre E-Mail-Adresse gesendet.",
  reference: "Referenznummer",
  submittedAt: "Eingegangen",
  fixErrors: "Bitte korrigieren Sie die markierten Felder.",
  tooMany: "Zu viele Übermittlungen von Ihrer Verbindung. Bitte versuchen Sie es später erneut.",
  expired: "Ihre Sitzung ist abgelaufen. Bitte überprüfen und senden Sie das Formular erneut.",
  unavailable: "Das Widerrufsformular ist derzeit nicht verfügbar. Bitte kontaktieren Sie den Shop direkt.",
  yes: "Ja",
  no: "Nein",
  periodNote: (d) => `Die gesetzliche Widerrufsfrist beträgt in der Regel ${d} Tage. Ausnahmen sind möglich.`,
  errors: {
    required: () => "Dieses Feld ist erforderlich.",
    invalid_email: () => "Geben Sie eine gültige E-Mail-Adresse ein.",
    invalid_phone: () => "Geben Sie eine gültige Telefonnummer ein.",
    invalid_number: () => "Geben Sie eine Zahl ein.",
    invalid_date: () => "Geben Sie ein gültiges Datum ein.",
    invalid_option: () => "Wählen Sie eine der verfügbaren Optionen.",
    too_short: (n) => `Geben Sie mindestens ${n} Zeichen ein.`,
    too_long: (n) => `Geben Sie höchstens ${n} Zeichen ein.`,
    too_small: (n) => `Der Wert muss mindestens ${n} betragen.`,
    too_large: (n) => `Der Wert darf höchstens ${n} betragen.`,
    invalid_format: () => "Das Format ist ungültig.",
  },
};

const fr: Strings = {
  continue: "Continuer vers la vérification",
  optional: "facultatif",
  selectPlaceholder: "Veuillez choisir",
  reviewHeading: "Veuillez vérifier votre rétractation",
  reviewIntro: "Vérifiez vos informations. Votre rétractation n’est envoyée que lorsque vous cliquez sur le bouton de confirmation.",
  edit: "Modifier",
  confirm: "Confirmer la rétractation",
  successHeading: "Votre rétractation a bien été reçue",
  successBody: "Nous avons enregistré votre déclaration de rétractation. Une confirmation a été envoyée à votre adresse e-mail.",
  reference: "Numéro de référence",
  submittedAt: "Reçue le",
  fixErrors: "Veuillez corriger les champs signalés.",
  tooMany: "Trop d’envois depuis votre connexion. Veuillez réessayer plus tard.",
  expired: "Votre session a expiré. Veuillez vérifier et envoyer à nouveau le formulaire.",
  unavailable: "Le formulaire de rétractation est momentanément indisponible. Veuillez contacter la boutique.",
  yes: "Oui",
  no: "Non",
  periodNote: (d) => `Le délai légal de rétractation est en général de ${d} jours. Des exceptions peuvent s’appliquer.`,
  errors: {
    required: () => "Ce champ est obligatoire.",
    invalid_email: () => "Saisissez une adresse e-mail valide.",
    invalid_phone: () => "Saisissez un numéro de téléphone valide.",
    invalid_number: () => "Saisissez un nombre.",
    invalid_date: () => "Saisissez une date valide.",
    invalid_option: () => "Choisissez l’une des options proposées.",
    too_short: (n) => `Saisissez au moins ${n} caractères.`,
    too_long: (n) => `Saisissez au plus ${n} caractères.`,
    too_small: (n) => `La valeur doit être d’au moins ${n}.`,
    too_large: (n) => `La valeur doit être d’au plus ${n}.`,
    invalid_format: () => "Le format n’est pas valide.",
  },
};

const es: Strings = {
  continue: "Continuar a la revisión",
  optional: "opcional",
  selectPlaceholder: "Seleccione",
  reviewHeading: "Revise su desistimiento",
  reviewIntro: "Compruebe sus datos. El desistimiento solo se envía cuando hace clic en el botón de confirmación.",
  edit: "Editar",
  confirm: "Confirmar desistimiento",
  successHeading: "Hemos recibido su desistimiento",
  successBody: "Hemos registrado su declaración de desistimiento. Se ha enviado una confirmación a su correo electrónico.",
  reference: "Número de referencia",
  submittedAt: "Recibido",
  fixErrors: "Corrija los campos marcados.",
  tooMany: "Demasiados envíos desde su conexión. Inténtelo de nuevo más tarde.",
  expired: "Su sesión ha caducado. Revise y envíe el formulario de nuevo.",
  unavailable: "El formulario de desistimiento no está disponible. Póngase en contacto con la tienda.",
  yes: "Sí",
  no: "No",
  periodNote: (d) => `El plazo legal de desistimiento suele ser de ${d} días. Pueden aplicarse excepciones.`,
  errors: {
    required: () => "Este campo es obligatorio.",
    invalid_email: () => "Introduzca un correo electrónico válido.",
    invalid_phone: () => "Introduzca un número de teléfono válido.",
    invalid_number: () => "Introduzca un número.",
    invalid_date: () => "Introduzca una fecha válida.",
    invalid_option: () => "Elija una de las opciones disponibles.",
    too_short: (n) => `Introduzca al menos ${n} caracteres.`,
    too_long: (n) => `Introduzca como máximo ${n} caracteres.`,
    too_small: (n) => `El valor debe ser al menos ${n}.`,
    too_large: (n) => `El valor debe ser como máximo ${n}.`,
    invalid_format: () => "El formato no es válido.",
  },
};

const it: Strings = {
  continue: "Continua alla verifica",
  optional: "facoltativo",
  selectPlaceholder: "Seleziona",
  reviewHeading: "Verifica il tuo recesso",
  reviewIntro: "Controlla i tuoi dati. Il recesso viene inviato solo quando fai clic sul pulsante di conferma.",
  edit: "Modifica",
  confirm: "Conferma il recesso",
  successHeading: "Abbiamo ricevuto il tuo recesso",
  successBody: "Abbiamo registrato la tua dichiarazione di recesso. Ti abbiamo inviato una conferma via email.",
  reference: "Numero di riferimento",
  submittedAt: "Ricevuto",
  fixErrors: "Correggi i campi evidenziati.",
  tooMany: "Troppi invii dalla tua connessione. Riprova più tardi.",
  expired: "La sessione è scaduta. Verifica e invia di nuovo il modulo.",
  unavailable: "Il modulo di recesso non è al momento disponibile. Contatta direttamente il negozio.",
  yes: "Sì",
  no: "No",
  periodNote: (d) => `Il periodo legale di recesso è generalmente di ${d} giorni. Possono applicarsi eccezioni.`,
  errors: {
    required: () => "Questo campo è obbligatorio.",
    invalid_email: () => "Inserisci un indirizzo email valido.",
    invalid_phone: () => "Inserisci un numero di telefono valido.",
    invalid_number: () => "Inserisci un numero.",
    invalid_date: () => "Inserisci una data valida.",
    invalid_option: () => "Scegli una delle opzioni disponibili.",
    too_short: (n) => `Inserisci almeno ${n} caratteri.`,
    too_long: (n) => `Inserisci al massimo ${n} caratteri.`,
    too_small: (n) => `Il valore deve essere almeno ${n}.`,
    too_large: (n) => `Il valore deve essere al massimo ${n}.`,
    invalid_format: () => "Il formato non è valido.",
  },
};

const nl: Strings = {
  continue: "Verder naar controle",
  optional: "optioneel",
  selectPlaceholder: "Maak een keuze",
  reviewHeading: "Controleer uw herroeping",
  reviewIntro: "Controleer uw gegevens. Uw herroeping wordt pas verzonden wanneer u op de bevestigingsknop klikt.",
  edit: "Bewerken",
  confirm: "Herroeping bevestigen",
  successHeading: "Uw herroeping is ontvangen",
  successBody: "Wij hebben uw herroepingsverklaring geregistreerd. Er is een bevestiging naar uw e-mailadres gestuurd.",
  reference: "Referentienummer",
  submittedAt: "Ontvangen",
  fixErrors: "Corrigeer de gemarkeerde velden.",
  tooMany: "Te veel inzendingen vanaf uw verbinding. Probeer het later opnieuw.",
  expired: "Uw sessie is verlopen. Controleer en verstuur het formulier opnieuw.",
  unavailable: "Het herroepingsformulier is momenteel niet beschikbaar. Neem rechtstreeks contact op met de winkel.",
  yes: "Ja",
  no: "Nee",
  periodNote: (d) => `De wettelijke herroepingstermijn is doorgaans ${d} dagen. Er kunnen uitzonderingen gelden.`,
  errors: {
    required: () => "Dit veld is verplicht.",
    invalid_email: () => "Voer een geldig e-mailadres in.",
    invalid_phone: () => "Voer een geldig telefoonnummer in.",
    invalid_number: () => "Voer een getal in.",
    invalid_date: () => "Voer een geldige datum in.",
    invalid_option: () => "Kies een van de beschikbare opties.",
    too_short: (n) => `Voer minimaal ${n} tekens in.`,
    too_long: (n) => `Voer maximaal ${n} tekens in.`,
    too_small: (n) => `De waarde moet minimaal ${n} zijn.`,
    too_large: (n) => `De waarde mag maximaal ${n} zijn.`,
    invalid_format: () => "Het formaat is ongeldig.",
  },
};

const DICTIONARIES: Record<Locale, Strings> = { en, de, fr, es, it, nl };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function strings(locale: string | null | undefined): Strings {
  return DICTIONARIES[isLocale(locale) ? locale : "en"];
}
