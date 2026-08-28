// Deployment configuration: the one thing that is a property of *this copy* of
// the site rather than of the code.
//
// EVERYTHING HERE IS PUBLIC. It ships inside the page and anyone can read it
// with View Source. That is not a leak, it is how OAuth works in a browser: a
// browser cannot keep a secret, so Google does not give it one. The client id
// is an identifier, and it is secured by an origin allowlist — it only works
// when the page asking is served from an address registered against it. Pasting
// it here is exactly as safe as the alternative, and it saves every visitor a
// Google Cloud project of their own.
//
// Injecting it at build or serve time instead is fine too: a
// `<meta name="brewkit-client-id" content="…">` in the page wins over this.
//
// To deploy your own copy: make an OAuth client id of type "Web application",
// add your origin under *Authorised JavaScript origins*, publish the consent
// screen (every scope this app asks for is non-sensitive, so no verification
// review is needed), and paste the id below.
export const GOOGLE_CLIENT_ID =
  '919707753958-octio7ddhsvt0uq19mest44dpnq811vd.apps.googleusercontent.com';
