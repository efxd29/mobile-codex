# Localization

Mobile Codex currently ships with an English-only interface. The app language is fixed to English regardless of the Android device locale. User/model messages, filenames, terminal output, project files, and custom instructions are never translated.

UI strings are translated from the bundled English catalog in `app/src/main/assets/translations-en.json` and its web copy in `app/src/main/assets/web/translations.js`. Keep both copies identical. Static text/attributes in the packaged HTML are captured before rendering.

Do not translate protocol identifiers, model responses, or data received from tools. Tests cover catalog parity, missing keys, switching the app to English while preserving drafts, and preserving user content.
