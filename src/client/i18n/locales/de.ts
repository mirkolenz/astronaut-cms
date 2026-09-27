import type en from "./en";
import type { TranslationShape } from "../types";

const de: TranslationShape<typeof en> = {
  common: {
    cancel: "Abbrechen",
    confirm: "Bestätigen",
    delete: "Löschen",
    save: "Speichern",
    saving: "Speichern...",
    discard: "Verwerfen",
    remove: "Entfernen",
    rename: "Umbenennen",
    replace: "Ersetzen",
    upload: "Hochladen",
    uploading: "Hochladen...",
    optimizing: "Optimieren...",
    create: "Erstellen",
    signOut: "Abmelden",
    overwrite: "Überschreiben",
  },
  layout: {
    appName: "Astronaut CMS",
    collections: "Sammlungen",
    assets: "Medien",
    media: "Medien",
    breadcrumbRoot: "CMS",
  },
  auth: {
    completingAuth: "Authentifizierung wird abgeschlossen...",
    signInGitHub: "Mit GitHub anmelden",
    signInGitLab: "Mit GitLab anmelden",
    enterCodeAt: "Geben Sie diesen Code ein auf",
    waitingAuth: "Warte auf Autorisierung...",
    unsupportedStorage: "Nicht unterstützter Speichertyp: {{type}}",
  },
  dashboard: {
    noCollections: "Keine Sammlungen gefunden",
    defineCollections:
      "Definieren Sie Sammlungen in Ihrer content.config.ts",
    contentCollection: "Inhaltssammlung",
    dataCollection: "Datensammlung",
    fields: "{{count}} Felder",
    failedLoad: "Sammlungen konnten nicht geladen werden: {{message}}",
  },
  collection: {
    newEntry: "Neuer Eintrag",
    addEntry: "Eintrag hinzufügen",
    noEntries: "Noch keine Einträge",
    contentCollection: "Inhaltssammlung",
    dataCollection: "Datensammlung",
    fileCollection: "Dateisammlung",
    entries: "{{count}} Einträge",
    failedLoad: "Einträge konnten nicht geladen werden: {{message}}",
    createStaged: "Erstellung vorgemerkt",
    deleteStaged: "Löschung vorgemerkt",
  },
  entry: {
    form: "Formular",
    raw: "Roh",
    fields: "Felder",
    dataJson: "Daten (JSON)",
    body: "Inhalt",
    unsavedChanges: "Ungespeicherte Änderungen",
    unsavedChangesMessage:
      "Sie haben ungespeicherte Änderungen. Möchten Sie diese verwerfen und die Seite verlassen?",
    deleteEntry: "Eintrag löschen",
    deleteEntryMessage:
      'Sind Sie sicher, dass Sie "{{id}}" löschen möchten? Dies kann nicht rückgängig gemacht werden.',
    changesStaged: "Änderungen vorgemerkt",
    entryAdded: "Eintrag hinzugefügt",
    invalidJson: "Ungültiges JSON im Roh-Editor",
    noSchema:
      "Kein Schema verfügbar. Verwenden Sie den Roh-Modus zur Bearbeitung.",
    noSchemaShort: "Kein Schema verfügbar.",
    modified: "geändert",
    failedLoad: "Eintrag konnte nicht geladen werden: {{message}}",
  },
  media: {
    title: "Medienbibliothek",
    noFiles: "Keine Mediendateien",
    noFilesFound: "Keine Mediendateien gefunden.",
    deleteFile: "Datei löschen",
    deleteFileMessage:
      "Sind Sie sicher, dass Sie diese Datei löschen möchten? Sie wird möglicherweise von Inhaltseinträgen referenziert.",
    fileExists: "Datei existiert bereits",
    fileExistsMessage:
      'Eine Datei mit dem Namen "{{name}}" existiert bereits. Überschreiben?',
    renameFile: "Datei umbenennen",
    current: "Aktuell: {{name}}",
    renaming: "Umbenennen...",
    selectMedia: "Medien auswählen",
    filterPlaceholder: "Dateien filtern...",
    failedLoad: "Medien konnten nicht geladen werden: {{message}}",
  },
  publish: {
    pendingChanges_one: "{{count}} ausstehende Änderung",
    pendingChanges_other: "{{count}} ausstehende Änderungen",
    publish: "Veröffentlichen",
    publishing: "Veröffentlichen...",
    discardChanges: "Änderungen verwerfen",
    discardChangesMessage:
      "Sind Sie sicher, dass Sie {{count}} ausstehende Änderung(en) verwerfen möchten? Dies kann nicht rückgängig gemacht werden.",
  },
  newEntryDialog: {
    title: "Neuer Eintrag in {{collection}}",
    entryId: "Eintrags-ID",
    placeholder: "mein-eintrag",
    validationHint:
      "Nur Buchstaben, Zahlen, Bindestriche und Unterstriche",
    format: "Format",
  },
  errors: {
    somethingWentWrong: "Etwas ist schiefgelaufen",
    tryAgain: "Erneut versuchen",
  },
  editors: {
    browse: "Durchsuchen",
    clear: "Leeren",
    setValue: "Wert setzen",
    addItem: "+ Element hinzufügen",
    add: "+ Hinzufügen",
    removeItem: "Element entfernen",
    removeItemMessage:
      "Sind Sie sicher, dass Sie Element {{index}} entfernen möchten? Alle verschachtelten Daten gehen verloren.",
    removeField: "Feld entfernen",
    removeFieldMessage:
      'Sind Sie sicher, dass Sie "{{key}}" entfernen möchten? Alle verschachtelten Daten gehen verloren.',
    newKey: "Neuer Schlüssel",
    variant: "Variante",
    raw: "(roh)",
    removeEntry: "Eintrag entfernen",
    removeEntryMessage:
      'Sind Sie sicher, dass Sie "{{id}}" entfernen möchten? Dies wird beim Veröffentlichen angewendet.',
    image: "Bild",
    file: "Datei",
    selectFrom: "Auswählen aus {{collection}}",
    loading: "Laden...",
    ref: "Ref: {{collection}}",
  },
} as const;

export default de;
