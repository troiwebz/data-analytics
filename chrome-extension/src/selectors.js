/* Injected as a plain script (not a module) alongside content-post.js.
 * EVERY BlackHatWorld / XenForo DOM selector lives here. When a theme update
 * breaks posting, this is the only file you need to touch. */
globalThis.HAF_SELECTORS = {
  // The quick-reply form at the bottom of a thread.
  form: [
    'form.js-quickReply',
    'form[data-xf-init~="quick-reply"]',
    '.js-quickReply',
    'form[action*="/post-reply"]'
  ],
  // Rich text editor surface (XenForo 2.x ships Froala).
  richEditor: [
    '.fr-element.fr-view[contenteditable="true"]',
    '[contenteditable="true"].fr-element',
    '.js-editor [contenteditable="true"]',
    'div[contenteditable="true"]'
  ],
  // Hidden field the form actually submits.
  hiddenInput: [
    'textarea.js-editorInput',
    'input.js-editorInput',
    'textarea[name="message_html"]',
    'input[name="message_html"]'
  ],
  // Plain BB-code editor, when the rich editor is disabled in preferences.
  plainTextarea: [
    'textarea[name="message"]',
    'textarea.input--textarea'
  ],
  submit: [
    'button.button--icon--reply',
    'button[type="submit"].button--primary',
    'button[type="submit"]',
    'input[type="submit"]'
  ],
  // Presence of any of these means we are not allowed to reply.
  blocked: [
    '.blockMessage--error',
    '.js-loginBar',
    '[data-template="login_form"]'
  ],
  // --- direct message compose page (/direct-messages/add) ---------------
  dmForm: [
    'form[action*="/direct-messages/insert"]',
    'form[action*="/direct-messages/add"]',
    'form[action*="/conversations/insert"]',
    '.p-body-main form'
  ],
  dmRecipients: [
    'input[name="recipients"]',
    '.js-tokenizerInput',
    'input[name="recipient_ids"]'
  ],
  dmTitle: [
    'input[name="title"]',
    'input.input--title'
  ],
  dmSubmit: [
    'button.button--icon--add',
    'button[type="submit"].button--primary',
    'button[type="submit"]',
    'input[type="submit"]'
  ],
  // Shown once a conversation exists — used to confirm the DM sent.
  dmSent: ['.p-title-value', '.message--conversation', 'article.message'],

  // Posts already on the page, used to confirm the reply landed.
  message: ['article.message', '.message--post']
};
